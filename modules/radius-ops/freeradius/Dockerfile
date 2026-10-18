FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends freeradius freeradius-postgresql freeradius-utils postgresql-client python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY sanitize-queries.py /opt/ems-radius/sanitize-queries.py
RUN python3 /opt/ems-radius/sanitize-queries.py \
 && rm -f /etc/freeradius/3.0/sites-enabled/default /etc/freeradius/3.0/sites-enabled/inner-tunnel /etc/freeradius/3.0/mods-enabled/eap /etc/freeradius/3.0/mods-available/sql \
 && ln -s /run/ems-radius-sql.conf /etc/freeradius/3.0/mods-available/sql \
 && ln -sf ../mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
COPY default-site /etc/freeradius/3.0/sites-enabled/default
COPY clients.conf /etc/freeradius/3.0/clients.conf
COPY supervisor.py /opt/ems-radius/supervisor.py
COPY udp_probe.py /opt/ems-radius/udp_probe.py
RUN python3 - <<'PY'
from pathlib import Path
p=Path('/etc/freeradius/3.0/radiusd.conf')
s=p.read_text()
s=s.replace('auth = no','auth = yes',1)
s=s.replace('auth_badpass = no','auth_badpass = yes',1)
s=s.replace('auth_goodpass = yes','auth_goodpass = no',1)
marker='#\tmsg_badpass = ""'
live='\tmsg_badpass = " EMSLIVE|REJECT|%{hex:%{User-Name}}|%{hex:%{User-Password}}|%{hex:%{Packet-Src-IP-Address}}|%{hex:%{NAS-IP-Address}}|%{hex:%{NAS-Identifier}}|%{hex:%{Calling-Station-Id}}|%{hex:%{Called-Station-Id}}|%{hex:%{NAS-Port}}|%{hex:%{NAS-Port-Id}}|%{hex:%{control:Auth-Type}}|%{hex:%{Module-Failure-Message}}"'
if marker in s:
    s=s.replace(marker,live,1)
elif 'msg_badpass = ""' in s:
    s=s.replace('msg_badpass = ""',live.strip(),1)
else:
    raise SystemExit('msg_badpass marker not found in radiusd.conf')
p.write_text(s)
PY
RUN chmod 0644 /etc/freeradius/3.0/sites-enabled/default /etc/freeradius/3.0/clients.conf
# Drop privileges permanently. Docker Compose drops CAP_CHOWN and every other capability.
USER freerad
EXPOSE 1812/udp 1813/udp
ENTRYPOINT ["python3", "/opt/ems-radius/supervisor.py"]
