FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates iputils-ping tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY server ./server
COPY public ./public

ENV NODE_ENV=production PORT=8090
EXPOSE 8090
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8090/network-map/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/main.mjs"]
