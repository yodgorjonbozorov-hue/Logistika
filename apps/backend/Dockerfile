# Backend image — build context is the repo root (workspace deps live outside apps/backend).
#   docker build -f apps/backend/Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Prisma's engines link against OpenSSL 3 on musl.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

# ---------- dependencies ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
# `backend...` pulls in the workspace packages backend depends on (shared) and
# nothing from the web app. Dev deps stay: the runtime needs the Prisma CLI to
# apply migrations on start.
RUN pnpm install --frozen-lockfile --filter backend...

# ---------- build ----------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter shared build \
  && pnpm --filter backend exec prisma generate \
  && pnpm --filter backend build

# ---------- runtime ----------
FROM base AS runtime
ENV NODE_ENV=production
# sharp downscales the driver's photos (TZ §8.3); tini reaps zombies.
RUN apk add --no-cache vips tini \
  && addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=app:app /app/packages/shared packages/shared
COPY --from=build --chown=app:app /app/apps/backend/node_modules apps/backend/node_modules
COPY --from=build --chown=app:app /app/apps/backend/package.json apps/backend/package.json
COPY --from=build --chown=app:app /app/apps/backend/prisma apps/backend/prisma
COPY --from=build --chown=app:app /app/apps/backend/dist apps/backend/dist
COPY --chown=app:app deploy/backend-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER app
WORKDIR /app/apps/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
