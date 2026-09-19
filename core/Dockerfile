FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
COPY core/package*.json ./core/
WORKDIR /app/core
RUN npm ci --omit=dev
WORKDIR /app
COPY core ./core
COPY modules ./modules
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=4s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "core/server/main.mjs"]
