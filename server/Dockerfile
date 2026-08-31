# ---------------------------------------------------------------------------
# API image.
#
# Multi-stage: `development` runs tsx in watch mode with source mounted from
# the host; `production` compiles TypeScript and ships only what is needed to
# run it.
#
# The production stage is a reasonable starting point, not a hardened artefact.
# It does not include TLS termination, secret management, or a process
# supervisor — those belong to the platform running the container.
# ---------------------------------------------------------------------------

# ------------------------------- base --------------------------------------
FROM node:20-bookworm-slim AS base
WORKDIR /app

# sharp needs libvips at runtime. Installing it here rather than letting sharp
# fall back to its bundled build keeps the image smaller and patchable by apt.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libvips42 dumb-init \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------- dependencies ---------------------------------
FROM base AS deps
COPY server/package.json server/package-lock.json* ./
RUN npm ci

# ---------------------------- development ----------------------------------
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src
# Served by /docs; read from disk so there is no second copy to drift.
COPY docs /docs

# Uploads live outside anything served statically.
RUN mkdir -p /app/var/uploads

EXPOSE 4000
# dumb-init gives the process a real PID 1 so Ctrl-C and `docker stop` deliver
# SIGTERM properly and the graceful shutdown handler actually runs.
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "tsx", "watch", "src/server.ts"]

# ------------------------------- build -------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ----------------------------- production ----------------------------------
FROM base AS production
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/package.json ./

# The API serves its OpenAPI spec from disk rather than embedding a second copy
# in code, so the file has to travel with the image.
COPY docs /docs

# Migrations are applied by an explicit step, never automatically on boot: two
# instances starting together would race, and an unattended migration is a bad
# thing to discover during an incident. (The migrator does take an advisory
# lock, but "it would probably be fine" is not a deployment strategy.)
COPY --from=build /app/dist/db ./dist/db

RUN mkdir -p /app/var/uploads \
 && chown -R node:node /app/var

# Never run as root.
USER node

EXPOSE 4000

# Compose/Kubernetes can use the readiness endpoint directly; this gives plain
# `docker run` something too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
