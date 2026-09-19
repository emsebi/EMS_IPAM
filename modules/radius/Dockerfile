FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends freeradius freeradius-postgresql procps ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY freeradius ./freeradius
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && mkdir -p /run/freeradius /etc/freeradius/3.0/clients.d && printf '\n$INCLUDE clients.d/*.conf\n' >> /etc/freeradius/3.0/clients.conf
ENV PORT=8091
EXPOSE 8091 1812/udp 1813/udp
ENTRYPOINT ["./entrypoint.sh"]
