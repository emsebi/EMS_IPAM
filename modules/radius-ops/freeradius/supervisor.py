#!/usr/bin/env python3
"""FreeRADIUS SQL NAS watcher. Does not log secrets or expose Docker socket."""
import json,os,pathlib,re,signal,socket,subprocess,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
STOP=False;RUNNING=False;RUNNING_SINCE=0.0;CHILD=None;DB_READY=False

def stop(*_):
 global STOP
 STOP=True
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
def udp_listeners_ready(ports=(1812, 1813), proc_file='/proc/net/udp', pid=None):
 """Verify the daemon owns UDP sockets reachable on the lab loopback.

 Port and inode alone are insufficient: the child could bind only to another
 interface, leaving the local RADIUS probe unreachable while health says OK.
 Require wildcard or 127.0.0.1 bindings and cross-check socket ownership.
 """
 if not isinstance(pid,int) or pid<=0:return False
 try:
  lines=pathlib.Path(proc_file).read_text().splitlines()
  if len(lines)<2 or 'local_address' not in lines[0]:return False
  port_inodes={port:set() for port in ports}
  # Linux /proc/net/udp stores IPv4 addresses in little-endian hex.
  loopback=socket.inet_aton('127.0.0.1')[::-1].hex().upper()
  valid_bind_addresses={'00000000',loopback}
  for line in lines[1:]:
   fields=line.split()
   if len(fields)<10 or ':' not in fields[1] or fields[3]!='07':continue
   bind_address,port_hex=fields[1].rsplit(':',1)
   port=int(port_hex,16)
   if (port in port_inodes and bind_address.upper() in valid_bind_addresses
       and fields[9].isdigit()):port_inodes[port].add(fields[9])
  if any(not inodes for inodes in port_inodes.values()):return False
  owned=set()
  for fd in pathlib.Path(f'/proc/{pid}/fd').iterdir():
   try:
    match=re.fullmatch(r'socket:\[([0-9]+)\]',os.readlink(fd))
    if match:owned.add(match.group(1))
   except (OSError,ValueError):
    # Descriptors can disappear while the daemon handles requests.
    continue
  return all(bool(inodes & owned) for inodes in port_inodes.values())
 except (OSError,ValueError):return False

class Health(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path!='/health':self.send_error(404);return
  healthy=DB_READY and RUNNING and CHILD is not None and CHILD.poll() is None and (time.monotonic()-RUNNING_SINCE)>=2.0 and udp_listeners_ready(pid=getattr(CHILD,'pid',None))
  data=json.dumps({'running':healthy,'eap':False}).encode();self.send_response(200 if healthy else 503);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def log_message(self,*_):pass

def sql_config(runtime_dir=None):
 keys=['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE']
 if any(not os.getenv(k) for k in keys):raise RuntimeError('Incomplete database environment')
 v={k:json.dumps(os.environ[k]) for k in keys}
 content='''sql {
 dialect = "postgresql"
 driver = "rlm_sql_postgresql"
 server = %(PGHOST)s
 port = %(PGPORT)s
 login = %(PGUSER)s
 password = %(PGPASSWORD)s
 radius_db = %(PGDATABASE)s
 acct_table1 = "radacct"
 acct_table2 = "radacct"
 postauth_table = "radpostauth"
 authcheck_table = "radcheck"
 groupcheck_table = "radgroupcheck"
 authreply_table = "radreply"
 groupreply_table = "radgroupreply"
 usergroup_table = "radusergroup"
 read_clients = yes
 client_table = "nas"
 read_groups = yes
 group_attribute = "SQL-Group"
 pool {
  start = 2
  min = 1
  max = 12
  spare = 2
  uses = 0
  lifetime = 0
 }
 $INCLUDE ${modconfdir}/${.:name}/main/${dialect}/queries.conf
}
'''%v
 # /run is a private container tmpfs; the daemon and watcher run as freerad.
 # No chown: CAP_CHOWN is intentionally absent from the container.
 runtime_dir=pathlib.Path('/run') if runtime_dir is None else pathlib.Path(runtime_dir)
 p=runtime_dir/'ems-radius-sql.conf'
 fd=os.open(p, os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW, 0o600)
 try:
  with os.fdopen(fd,'w') as out:out.write(content)
 except:
  try:os.close(fd)
  except OSError:pass
  raise
 p.chmod(0o600)
 run=runtime_dir/'freeradius';run.mkdir(exist_ok=True,mode=0o700);run.chmod(0o700)

def fingerprint():
 # Length-delimited JSON arrays avoid ambiguous concatenations when secrets
 # contain commas/pipes. Track EVERY SQL client field, not just name/secret:
 # a change to type/ports/server must also reload the FreeRADIUS client list.
 # Only the digest is returned by PostgreSQL; no secret is printed to logs.
 q=("SELECT md5(coalesce(jsonb_agg(jsonb_build_array("
    "id,nasname,shortname,type,ports,secret,server,community,description) "
    "ORDER BY nasname,id)::text,'[]')) FROM nas")
 try:
  r=subprocess.run(['psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-c',q],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=8,env={**os.environ,'PGCONNECT_TIMEOUT':'3'})
  digest=r.stdout.strip()
  # Even a zero-row NAS table returns md5('[]'). Blank/diagnostic output
  # is a failed DB readiness check, not an empty/healthy NAS inventory.
  if r.returncode!=0 or len(digest)!=32 or any(c not in '0123456789abcdef' for c in digest):return None
  return digest
 except (OSError,subprocess.TimeoutExpired):return None

def main():
 global RUNNING,RUNNING_SINCE,CHILD,DB_READY
 threading.Thread(target=lambda:ThreadingHTTPServer(('0.0.0.0',18120),Health).serve_forever(),daemon=True).start()
 sql_config()
 print('[radius-ops] Waiting for database migrations',flush=True)
 while not STOP:
  # Never launch the listener while PostgreSQL is unavailable.  This is
  # checked on EVERY restart, including after a FreeRADIUS crash.
  baseline=fingerprint()
  DB_READY=baseline is not None
  if baseline is None:
   time.sleep(3)
   continue
  try:
   p=subprocess.Popen(['/usr/sbin/freeradius','-f','-l','stdout'])
  except OSError:
   DB_READY=False
   time.sleep(3)
   continue
  CHILD=p
  RUNNING=p.poll() is None
  RUNNING_SINCE=time.monotonic()
  while not STOP and p.poll() is None:
   time.sleep(5)
   latest=fingerprint()
   DB_READY=latest is not None
   if latest is None:
    # A 503 health endpoint alone is insufficient: terminate the UDP
    # listener on database loss to prevent stale authorization decisions.
    print('[radius-ops] Database unavailable, stopping RADIUS listener',flush=True)
    break
   if latest!=baseline:
    print('[radius-ops] NAS list changed, restarting',flush=True)
    break
  RUNNING=False
  CHILD=None
  if p.poll() is None:
   p.terminate()
   try:p.wait(timeout=12)
   except subprocess.TimeoutExpired:p.kill();p.wait()
  if not STOP:time.sleep(3)
if __name__=='__main__':main()
