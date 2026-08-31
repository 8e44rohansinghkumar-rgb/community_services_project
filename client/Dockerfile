# ---------------------------------------------------------------------------
# SPA image.
#
# `development` runs the Vite dev server with HMR. `production` builds static
# assets and serves them with nginx, which also proxies /api to the API so the
# browser makes same-origin requests only — that is what keeps the auth cookies
# first-party and SameSite=Lax workable.
# ---------------------------------------------------------------------------

# ------------------------------- base --------------------------------------
FROM node:20-bookworm-slim AS base
WORKDIR /app

# ---------------------------- dependencies ---------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ---------------------------- development ----------------------------------
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]

# ------------------------------- build -------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No VITE_API_BASE_URL is baked in: the app calls same-origin /api and nginx
# routes it. Anything inlined at build time would be public anyway.
RUN npm run build

# ----------------------------- production ----------------------------------
FROM nginx:1.27-alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
