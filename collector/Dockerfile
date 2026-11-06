# NexusWatch collector. Build from the repo root: docker build -f collector/Dockerfile .
# The collector imports the dashboard's contract types and sample data from source, so the
# image carries those dashboard files too (and nothing else of the dashboard).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY collector/package.json collector/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace collector --include-workspace-root=false --omit=dev && npm cache clean --force

COPY dashboard/tsconfig.json dashboard/
COPY dashboard/src/api/types.ts dashboard/src/api/
COPY dashboard/src/api/mock/data.ts dashboard/src/api/mock/
COPY dashboard/src/lib/series.ts dashboard/src/lib/
COPY collector/tsconfig.json collector/
COPY collector/src collector/src

WORKDIR /app/collector
ENV NW_PORT=8080 NW_DB_PATH=/data/nexuswatch.db
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
