#!/usr/bin/env python3
"""FreeRADIUS SQL NAS watcher. Does not log secrets or expose Docker socket."""
import collections,json,os,pathlib,re,secrets,signal,socket,subprocess,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
STOP=False;RUNNING=False;RUNNING_SINCE=0.0;CHILD=None;DB_READY=False;CONFIG_READY=False
LIVE_LOCK=threading.Lock();LIVE_EVENTS=collections.deque(maxlen=1000);LIVE_SUBSCRIBERS={};LIVE_SEQ=0
LIVE_COLLECTOR_READY=False
SERVICE_ERRORS=collections.deque(maxlen=40);LAST_AUTH_AT=0.0;LAST_EVENT_AT=0.0

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

def _live_prune(now=None):
 now=time.monotonic() if now is None else now
 expired=[token for token,deadline in LIVE_SUBSCRIBERS.items() if deadline<=now]
 for token in expired:LIVE_SUBSCRIBERS.pop(token,None)
 if not LIVE_SUBSCRIBERS:LIVE_EVENTS.clear()

def live_start():
 global LIVE_SEQ
 with LIVE_LOCK:
  _live_prune()
  if not LIVE_SUBSCRIBERS:
   LIVE_EVENTS.clear();LIVE_SEQ=0
  token=secrets.token_urlsafe(24)
  LIVE_SUBSCRIBERS[token]=time.monotonic()+12
  return token,LIVE_SEQ

def live_snapshot(token,after=0):
 with LIVE_LOCK:
  _live_prune()
  if token not in LIVE_SUBSCRIBERS:return None
  LIVE_SUBSCRIBERS[token]=time.monotonic()+12
  return {'active':True,'seq':LIVE_SEQ,'items':[e for e in LIVE_EVENTS if e['seq']>after]}

def live_stop(token):
 with LIVE_LOCK:
  LIVE_SUBSCRIBERS.pop(token,None);_live_prune()
  return True

def live_add(event):
 global LIVE_SEQ,LAST_AUTH_AT,LAST_EVENT_AT
 now=time.time();LAST_EVENT_AT=now
 if event.get('type')=='authentication':LAST_AUTH_AT=now
 with LIVE_LOCK:
  _live_prune()
  if not LIVE_SUBSCRIBERS:return False
  LIVE_SEQ+=1
  item={'seq':LIVE_SEQ,'at':now,**event}
  LIVE_EVENTS.append(item)
  return True

def _hex_text(value):
 if not value:return ''
 value=value.strip()
 if value.lower().startswith('0x'):value=value[2:]
 try:return bytes.fromhex(value).decode('utf-8','replace')
 except (ValueError,UnicodeDecodeError):return ''

def parse_live_line(line):
 parts=line.rstrip('\r\n').split('|')
 if len(parts)!=15:return None
 (kind,result,user_hex,password_hex,source_hex,nas_ip_hex,nas_id_hex,
  calling_hex,called_hex,framed_ip_hex,nas_port_hex,nas_port_id_hex,
  method_hex,client_hex,reason_hex)=parts
 if kind not in ('AUTH','ACCT'):return None
 method=_hex_text(method_hex)
 attempted=_hex_text(password_hex) if kind=='AUTH' else ''
 return {
  'type':'authentication' if kind=='AUTH' else 'accounting',
  'result':result,
  'username':_hex_text(user_hex),
  'attemptedPassword':attempted,
  'passwordAvailable':bool(attempted),
  'sourceIp':_hex_text(source_hex),
  'nasIp':_hex_text(nas_ip_hex),
  'nasIdentifier':_hex_text(nas_id_hex),
  'callingStationId':_hex_text(calling_hex),
  'calledStationId':_hex_text(called_hex),
  'framedIpAddress':_hex_text(framed_ip_hex),
  'nasPort':_hex_text(nas_port_hex),
  'nasPortId':_hex_text(nas_port_id_hex),
  'authMethod':method,
  'clientShortname':_hex_text(client_hex),
  'reason':_hex_text(reason_hex),
 }

def _meta_fields(extra):
 marker='EMSMETA '
 pos=extra.find(marker)
 if pos<0:return {}
 out={}
 for part in extra[pos+len(marker):].split(';'):
  if '=' not in part:continue
  key,value=part.split('=',1);out[key.strip()]=value.strip()
 return out

def parse_native_auth_line(msg):
 # Use FreeRADIUS 3.x native auth/auth_badpass output instead of inserting a
 # custom logging module in the authentication path.
 native=re.search(
  r'Login (?P<state>OK|incorrect)(?: \((?P<reason>.*?)\))?: '
  r'\[(?P<creds>[^\]]*)\] \(from client (?P<client>\S+) '
  r'port (?P<port>[^ )]+)(?: cli (?P<calling>[^)]*))?\)(?P<extra>.*)$',
  msg)
 if native:
  creds=native.group('creds');username=creds;attempted=''
  if '/' in creds:
   username,attempted=creds.split('/',1)
  if attempted.startswith('<') and attempted.endswith('>'):attempted=''
  meta=_meta_fields(native.group('extra') or '')
  reason=native.group('reason') or ''
  method=meta.get('method','')
  if not method:
   hit=re.search(r'\b(pap|chap|mschapv2?|eap)\b',reason,re.I)
   if hit:method=hit.group(1).upper().replace('MSCHAP','MS-CHAP')
   elif attempted:method='PAP'
  return {
   'type':'authentication',
   'result':'ACCEPT' if native.group('state')=='OK' else 'REJECT',
   'username':username,
   'attemptedPassword':attempted,
   'passwordAvailable':bool(attempted),
   'sourceIp':meta.get('src',''),
   'nasIp':meta.get('nasip',''),
   'nasIdentifier':meta.get('nasid',''),
   'callingStationId':meta.get('calling','') or (native.group('calling') or ''),
   'calledStationId':meta.get('called',''),
   'framedIpAddress':meta.get('framed',''),
   'nasPort':native.group('port') or '',
   'nasPortId':'',
   'authMethod':method,
   'clientShortname':native.group('client') or '',
   'reason':reason,
  }
 unknown=re.search(r'from unknown client ([0-9A-Fa-f:.]+)',msg)
 if unknown:
  return {'type':'transport','result':'DROP','sourceIp':unknown.group(1),
          'reason':'unknown RADIUS client','message':msg}
 if 'Shared secret is incorrect' in msg or 'invalid Request Authenticator' in msg:
  src=re.search(r'(?:packet from|from) ([0-9A-Fa-f:.]+)',msg,re.I)
  return {'type':'transport','result':'DROP','sourceIp':src.group(1) if src else '',
          'reason':'shared secret mismatch','message':msg}
 return None

def _safe_service_status(msg):
 low=msg.lower()
 if any(word in low for word in ('user-password','cleartext-password','shared secret','password =','secret =')):return
 if any(word in low for word in ('error','failed','warning','ready','listening')):
  SERVICE_ERRORS.append(msg[:500])

def freeradius_config_check():
 global CONFIG_READY
 try:
  r=subprocess.run(['/usr/sbin/freeradius','-XC'],stdout=subprocess.PIPE,
                   stderr=subprocess.STDOUT,text=True,timeout=20)
  lines=(r.stdout or '').splitlines()
  for line in lines:_safe_service_status(line)
  CONFIG_READY=(r.returncode==0)
  if not CONFIG_READY:
   # Config errors must be diagnosable without SSH. Never print lines which
   # could contain credentials or shared secrets.
   safe=[]
   for line in lines:
    low=line.lower()
    if any(word in low for word in ('password','secret','user-password','cleartext')):continue
    if any(word in low for word in ('error','failed','invalid','unknown','unexpected',
                                     'including configuration file','errors reading',
                                     'parse','syntax','rlm_linelog','ems-live-log')):
     safe.append(line[:700])
   print('[radius-ops] FreeRADIUS config check failed',flush=True)
   for line in safe[-24:]:print('[radius-ops] config: '+line,flush=True)
 except (OSError,subprocess.TimeoutExpired):
  CONFIG_READY=False
  SERVICE_ERRORS.append('FreeRADIUS configuration check could not run')
  print('[radius-ops] FreeRADIUS config check could not run',flush=True)
 return CONFIG_READY

def service_output_reader(pipe):
 global LIVE_COLLECTOR_READY
 # Child stdout is held by the supervisor and never forwarded to Docker logs.
 # Native auth_badpass lines are parsed into the in-memory live stream only.
 LIVE_COLLECTOR_READY=True
 try:
  for line in pipe:
   msg=line.rstrip('\r\n')
   if not msg:continue
   _safe_service_status(msg)
   event=parse_native_auth_line(msg)
   if event:live_add(event)
   elif 'Login incorrect' not in msg:live_add({'type':'service','result':'INFO','message':msg})
 finally:
  LIVE_COLLECTOR_READY=False
  try:pipe.close()
  except Exception:pass

class Health(BaseHTTPRequestHandler):
 def _json(self,status,payload):
  data=json.dumps(payload,separators=(',',':')).encode()
  self.send_response(status);self.send_header('Content-Type','application/json')
  self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
  self.end_headers();self.wfile.write(data)
 def _body(self):
  try:n=int(self.headers.get('Content-Length','0'))
  except ValueError:return {}
  if n<0 or n>4096:return {}
  try:return json.loads(self.rfile.read(n) or b'{}')
  except (json.JSONDecodeError,UnicodeDecodeError):return {}
 def do_GET(self):
  alive=RUNNING and CHILD is not None and CHILD.poll() is None
  auth_ready=udp_listeners_ready(ports=(1812,),pid=getattr(CHILD,'pid',None)) if alive else False
  acct_ready=udp_listeners_ready(ports=(1813,),pid=getattr(CHILD,'pid',None)) if alive else False
  healthy=DB_READY and CONFIG_READY and alive and (time.monotonic()-RUNNING_SINCE)>=2.0 and auth_ready and acct_ready
  if self.path=='/health':
   self._json(200 if healthy else 503,{'running':healthy,'eap':False,'liveVolatile':True});return
  if self.path=='/diagnostics':
   with LIVE_LOCK:
    _live_prune();subs=len(LIVE_SUBSCRIBERS);buffered=len(LIVE_EVENTS)
   self._json(200,{'ok':True,'running':healthy,'databaseReady':DB_READY,'configReady':CONFIG_READY,
    'processAlive':alive,'auth1812Ready':auth_ready,'accounting1813Ready':acct_ready,
    'liveCollectorReady':LIVE_COLLECTOR_READY,'liveSubscribers':subs,'liveBufferedEvents':buffered,
    'lastAuthAt':LAST_AUTH_AT or None,'lastEventAt':LAST_EVENT_AT or None,
    'serviceMessages':list(SERVICE_ERRORS)[-12:]});return
  self.send_error(404)
 def do_POST(self):
  if self.path=='/live/start':
   token,seq=live_start();self._json(200,{'ok':True,'token':token,'seq':seq,'volatile':True});return
  if self.path=='/live/events':
   body=self._body();token=body.get('token','');after=body.get('after',0)
   if not isinstance(token,str) or not isinstance(after,int) or after<0:self._json(400,{'ok':False});return
   data=live_snapshot(token,after)
   if data is None:self._json(410,{'ok':False,'active':False});return
   self._json(200,{'ok':True,**data});return
  if self.path=='/live/stop':
   body=self._body();token=body.get('token','')
   if isinstance(token,str):live_stop(token)
   self._json(200,{'ok':True});return
  self.send_error(404)
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
 global RUNNING,RUNNING_SINCE,CHILD,DB_READY,CONFIG_READY
 threading.Thread(target=lambda:ThreadingHTTPServer(('0.0.0.0',18120),Health).serve_forever(),daemon=True).start()
 sql_config()
 print('[radius-ops] Waiting for database migrations',flush=True)
 while not STOP:
  # Never launch the listener while PostgreSQL is unavailable.  This is
  # checked on EVERY restart, including after a FreeRADIUS crash.
  baseline=fingerprint()
  DB_READY=baseline is not None
  if baseline is None:
   CONFIG_READY=False
   time.sleep(3)
   continue
  if not freeradius_config_check():
   time.sleep(3)
   continue
  try:
   p=subprocess.Popen(['/usr/sbin/freeradius','-f','-l','stdout'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  except OSError:
   DB_READY=False
   time.sleep(3)
   continue
  CHILD=p
  if getattr(p,'stdout',None) is not None:threading.Thread(target=service_output_reader,args=(p.stdout,),daemon=True).start()
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
,msg)
 if native:
  creds=native.group('creds');username=creds;attempted=''
  if '/' in creds:
   username,attempted=creds.split('/',1)
  if attempted.startswith('<') and attempted.endswith('>'):attempted=''
  meta=_meta_fields(native.group('extra') or '')
  reason=native.group('reason') or ''
  method=meta.get('method','')
  if not method:
   hit=re.search(r'\\b(pap|chap|mschapv2?|eap)\\b',reason,re.I)
   if hit:method=hit.group(1).upper().replace('MSCHAP','MS-CHAP')
   elif attempted:method='PAP'
  return {
   'type':'authentication',
   'result':'ACCEPT' if native.group('state')=='OK' else 'REJECT',
   'username':username,
   'attemptedPassword':attempted,
   'passwordAvailable':bool(attempted),
   'sourceIp':meta.get('src',''),
   'nasIp':meta.get('nasip',''),
   'nasIdentifier':meta.get('nasid',''),
   'callingStationId':meta.get('calling','') or (native.group('calling') or ''),
   'calledStationId':meta.get('called',''),
   'framedIpAddress':meta.get('framed',''),
   'nasPort':native.group('port') or '',
   'nasPortId':'',
   'authMethod':method,
   'clientShortname':native.group('client') or '',
   'reason':reason,
  }
 unknown=re.search(r'from unknown client ([0-9A-Fa-f:.]+)',msg)
 if unknown:
  return {'type':'transport','result':'DROP','sourceIp':unknown.group(1),
          'reason':'unknown RADIUS client','message':msg}
 if 'Shared secret is incorrect' in msg or 'invalid Request Authenticator' in msg:
  src=re.search(r'(?:packet from|from) ([0-9A-Fa-f:.]+)',msg,re.I)
  return {'type':'transport','result':'DROP','sourceIp':src.group(1) if src else '',
          'reason':'shared secret mismatch','message':msg}
 return None

def _safe_service_status(msg):
 low=msg.lower()
 if any(word in low for word in ('user-password','cleartext-password','shared secret','password =','secret =')):return
 if any(word in low for word in ('error','failed','warning','ready','listening')):
  SERVICE_ERRORS.append(msg[:500])

def freeradius_config_check():
 global CONFIG_READY
 try:
  r=subprocess.run(['/usr/sbin/freeradius','-XC'],stdout=subprocess.PIPE,
                   stderr=subprocess.STDOUT,text=True,timeout=20)
  lines=(r.stdout or '').splitlines()
  for line in lines:_safe_service_status(line)
  CONFIG_READY=(r.returncode==0)
  if not CONFIG_READY:
   # Config errors must be diagnosable without SSH. Never print lines which
   # could contain credentials or shared secrets.
   safe=[]
   for line in lines:
    low=line.lower()
    if any(word in low for word in ('password','secret','user-password','cleartext')):continue
    if any(word in low for word in ('error','failed','invalid','unknown','unexpected',
                                     'including configuration file','errors reading',
                                     'parse','syntax','rlm_linelog','ems-live-log')):
     safe.append(line[:700])
   print('[radius-ops] FreeRADIUS config check failed',flush=True)
   for line in safe[-24:]:print('[radius-ops] config: '+line,flush=True)
 except (OSError,subprocess.TimeoutExpired):
  CONFIG_READY=False
  SERVICE_ERRORS.append('FreeRADIUS configuration check could not run')
  print('[radius-ops] FreeRADIUS config check could not run',flush=True)
 return CONFIG_READY

def service_output_reader(pipe):
 global LIVE_COLLECTOR_READY
 # Child stdout is held by the supervisor and never forwarded to Docker logs.
 # Native auth_badpass lines are parsed into the in-memory live stream only.
 LIVE_COLLECTOR_READY=True
 try:
  for line in pipe:
   msg=line.rstrip('\r\n')
   if not msg:continue
   _safe_service_status(msg)
   event=parse_native_auth_line(msg)
   if event:live_add(event)
   elif 'Login incorrect' not in msg:live_add({'type':'service','result':'INFO','message':msg})
 finally:
  LIVE_COLLECTOR_READY=False
  try:pipe.close()
  except Exception:pass

class Health(BaseHTTPRequestHandler):
 def _json(self,status,payload):
  data=json.dumps(payload,separators=(',',':')).encode()
  self.send_response(status);self.send_header('Content-Type','application/json')
  self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
  self.end_headers();self.wfile.write(data)
 def _body(self):
  try:n=int(self.headers.get('Content-Length','0'))
  except ValueError:return {}
  if n<0 or n>4096:return {}
  try:return json.loads(self.rfile.read(n) or b'{}')
  except (json.JSONDecodeError,UnicodeDecodeError):return {}
 def do_GET(self):
  alive=RUNNING and CHILD is not None and CHILD.poll() is None
  auth_ready=udp_listeners_ready(ports=(1812,),pid=getattr(CHILD,'pid',None)) if alive else False
  acct_ready=udp_listeners_ready(ports=(1813,),pid=getattr(CHILD,'pid',None)) if alive else False
  healthy=DB_READY and CONFIG_READY and alive and (time.monotonic()-RUNNING_SINCE)>=2.0 and auth_ready and acct_ready
  if self.path=='/health':
   self._json(200 if healthy else 503,{'running':healthy,'eap':False,'liveVolatile':True});return
  if self.path=='/diagnostics':
   with LIVE_LOCK:
    _live_prune();subs=len(LIVE_SUBSCRIBERS);buffered=len(LIVE_EVENTS)
   self._json(200,{'ok':True,'running':healthy,'databaseReady':DB_READY,'configReady':CONFIG_READY,
    'processAlive':alive,'auth1812Ready':auth_ready,'accounting1813Ready':acct_ready,
    'liveCollectorReady':LIVE_COLLECTOR_READY,'liveSubscribers':subs,'liveBufferedEvents':buffered,
    'lastAuthAt':LAST_AUTH_AT or None,'lastEventAt':LAST_EVENT_AT or None,
    'serviceMessages':list(SERVICE_ERRORS)[-12:]});return
  self.send_error(404)
 def do_POST(self):
  if self.path=='/live/start':
   token,seq=live_start();self._json(200,{'ok':True,'token':token,'seq':seq,'volatile':True});return
  if self.path=='/live/events':
   body=self._body();token=body.get('token','');after=body.get('after',0)
   if not isinstance(token,str) or not isinstance(after,int) or after<0:self._json(400,{'ok':False});return
   data=live_snapshot(token,after)
   if data is None:self._json(410,{'ok':False,'active':False});return
   self._json(200,{'ok':True,**data});return
  if self.path=='/live/stop':
   body=self._body();token=body.get('token','')
   if isinstance(token,str):live_stop(token)
   self._json(200,{'ok':True});return
  self.send_error(404)
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
 global RUNNING,RUNNING_SINCE,CHILD,DB_READY,CONFIG_READY
 threading.Thread(target=lambda:ThreadingHTTPServer(('0.0.0.0',18120),Health).serve_forever(),daemon=True).start()
 sql_config()
 print('[radius-ops] Waiting for database migrations',flush=True)
 while not STOP:
  # Never launch the listener while PostgreSQL is unavailable.  This is
  # checked on EVERY restart, including after a FreeRADIUS crash.
  baseline=fingerprint()
  DB_READY=baseline is not None
  if baseline is None:
   CONFIG_READY=False
   time.sleep(3)
   continue
  if not freeradius_config_check():
   time.sleep(3)
   continue
  try:
   p=subprocess.Popen(['/usr/sbin/freeradius','-f','-l','stdout'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  except OSError:
   DB_READY=False
   time.sleep(3)
   continue
  CHILD=p
  if getattr(p,'stdout',None) is not None:threading.Thread(target=service_output_reader,args=(p.stdout,),daemon=True).start()
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
