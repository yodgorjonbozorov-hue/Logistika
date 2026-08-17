# Multi-stage build for the NestJS API.
# Context is the monorepo root: the backend depends on packages/shared through
# a pnpm workspace link, so the build needs both.
#   docker build -f apps/backend/Dockerfile -t truckcontrol-api .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter shared build \
  && pnpm --filter backend exec prisma generate \
  && pnpm --filter backend build

# Reinstall without dev dependencies; the Prisma client is regenerated because
# `pnpm install` prunes the generated client along with the dev tree.
RUN pnpm install --frozen-lockfile --prod \
  && pnpm --filter backend exec prisma generate

# ---------- runtime ----------
FROM base AS runtime
ENV NODE_ENV=production

# sharp needs the runtime libs, not the build toolchain.
RUN apk add --no-cache vips dumb-init \
  && addgroup -S app && adduser -S -G app app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/shared ./packages/shared
COPY --from=build --chown=app:app /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build --chown=app:app /app/apps/backend/dist ./apps/backend/dist
COPY --from=build --chown=app:app /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=build --chown=app:app /app/apps/backend/package.json ./apps/backend/package.json

USER app
WORKDIR /app/apps/backend
EXPOSE 3000

# Migrations are applied by a separate one-shot service, never by the API on
# boot: several replicas racing `migrate deploy` is how schemas get corrupted.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
