# NexusWatch dashboard, built against the real API and served by nginx, which proxies /api to the
# collector. Build from the repo root: docker build -f dashboard/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
COPY collector/package.json collector/
RUN npm ci --workspace dashboard --include-workspace-root=false
COPY dashboard dashboard
ARG VITE_USE_MOCKS=false
ARG VITE_REFRESH_MS=10000
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS VITE_REFRESH_MS=$VITE_REFRESH_MS
RUN npm --workspace dashboard run build

FROM nginx:1.27-alpine
COPY dashboard/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dashboard/dist /usr/share/nginx/html
ENV NW_API_UPSTREAM=http://collector:8080
EXPOSE 80
