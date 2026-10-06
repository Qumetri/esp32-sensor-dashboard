# Runs the server and dashboard in a container:
#   docker build -t esp32-sensor-dashboard .
#   docker run -d -p 3001:3001 -e SENSOR_TOKEN=<secret> \
#     -v "$PWD/WebServer/data:/app/WebServer/data" esp32-sensor-dashboard
#
# Two stages: the full node image has the compilers better-sqlite3 falls back
# to when no prebuilt binary matches, and the slim image only runs the result.
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY WebServer ./WebServer
RUN npm run build:client

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=build /app /app
# The database lives in WebServer/data; mount a volume there to keep it.
RUN mkdir -p WebServer/data && chown node:node WebServer/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node_modules/.bin/tsx", "WebServer/index.ts"]
