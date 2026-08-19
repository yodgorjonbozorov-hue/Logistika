# Web image — build context is the repo root (workspace deps live outside apps/web).
#   docker build -f apps/web/Dockerfile .
# The result is the edge: nginx serves the SPA and proxies /api to the backend.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---------- dependencies ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter web...

# ---------- build ----------
FROM deps AS build
# Same-origin by default: nginx proxies /api/v1 to the backend, so the bundle
# needs no absolute API host. Override for a split deployment.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter shared build && pnpm --filter web build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime
# The stock default server would also answer on :80 and shadow ours.
RUN rm /etc/nginx/conf.d/default.conf
# The template is rendered by nginx's own envsubst entrypoint at start-up;
# docker-compose mounts the HTTP or the TLS variant over this default.
COPY deploy/nginx/app.conf.template /etc/nginx/templates/app.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
