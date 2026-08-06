FROM rclone/rclone:1.74.3 AS rclone

FROM node:25-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY dashboard ./dashboard
COPY capacitor.config.json ./capacitor.config.json
COPY postcss.config.js tailwind.config.js ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:25-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    SAVESYNC_HOST=127.0.0.1 \
    SAVESYNC_DATA_DIR=/app/savesync-data \
    SAVESYNC_CONFIG=/app/savesync-data/config.yaml \
    SAVESYNC_RCLONE_CONFIG=/app/savesync-data/rclone/rclone.conf

COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dashboard/dist ./dashboard/dist
COPY package.json ./package.json
COPY server ./server
COPY config.example.yaml ./config.example.yaml

RUN mkdir -p /app/savesync-data/games /app/savesync-data/conflicts \
  && chown -R node:node /app/savesync-data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{Authorization:'Bearer '+(process.env.SAVESYNC_API_TOKEN||'')}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server/index.js"]
