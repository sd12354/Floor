# One process: the API and the built dashboard, SQLite on a volume.
FROM node:22-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @floor/core build \
  && pnpm --filter @floor/web build \
  && pnpm --filter @floor/api build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN useradd --create-home --uid 10001 floor \
  && mkdir -p /data \
  && chown floor:floor /data
COPY --from=build --chown=floor:floor /app /app
USER floor
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    WEB_DIST=/app/apps/web/dist \
    DATABASE_URL=file:/data/floor.db \
    NODE_OPTIONS=--experimental-wasm-modules
EXPOSE 4000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
