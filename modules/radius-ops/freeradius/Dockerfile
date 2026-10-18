FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends freeradius freeradius-postgresql freeradius-utils postgresql-client python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY sanitize-queries.py /opt/ems-radius/sanitize-queries.py
RUN python3 /opt/ems-radius/sanitize-queries.py \
 && rm -f /etc/freeradius/3.0/sites-enabled/default /etc/freeradius/3.0/sites-enabled/inner-tunnel /etc/freeradius/3.0/mods-enabled/eap /etc/freeradius/3.0/mods-available/sql \
 && ln -s /run/ems-radius-sql.conf /etc/freeradius/3.0/mods-available/sql \
 && ln -sf ../mods-available/sql /etc/freeradius/3.0/mods-enabled/sql \
 && sed -ri 's/^([[:space:]]*)auth = no$/\\1auth = yes/' /etc/freeradius/3.0/radiusd.conf \
 && sed -ri 's/^([[:space:]]*)auth_badpass = no$/\\1auth_badpass = yes/' /etc/freeradius/3.0/radiusd.conf \
 && sed -ri 's/^([[:space:]]*)auth_goodpass = no$/\\1auth_goodpass = yes/' /etc/freeradius/3.0/radiusd.conf \
 && sed -ri 's@^[[:space:]]*#[[:space:]]*msg_goodpass = ""@    msg_goodpass = " EMSMETA src=%{request:Packet-Src-IP-Address};nasip=%{request:NAS-IP-Address};nasid=%{request:NAS-Identifier};calling=%{request:Calling-Station-Id};called=%{request:Called-Station-Id};framed=%{request:Framed-IP-Address};method=%{control:Auth-Type}"@' /etc/freeradius/3.0/radiusd.conf \
 && sed -ri 's@^[[:space:]]*#[[:space:]]*msg_badpass = ""@    msg_badpass = " EMSMETA src=%{request:Packet-Src-IP-Address};nasip=%{request:NAS-IP-Address};nasid=%{request:NAS-Identifier};calling=%{request:Calling-Station-Id};called=%{request:Called-Station-Id};framed=%{request:Framed-IP-Address};method=%{control:Auth-Type}"@' /etc/freeradius/3.0/radiusd.conf
COPY default-site /etc/freeradius/3.0/sites-enabled/default
COPY clients.conf /etc/freeradius/3.0/clients.conf
COPY supervisor.py /opt/ems-radius/supervisor.py
COPY udp_probe.py /opt/ems-radius/udp_probe.py
RUN chmod 0644 /etc/freeradius/3.0/sites-enabled/default /etc/freeradius/3.0/clients.conf
# Drop privileges permanently. Docker Compose drops CAP_CHOWN and every other capability.
USER freerad
EXPOSE 1812/udp 1813/udp
ENTRYPOINT ["python3", "/opt/ems-radius/supervisor.py"]
