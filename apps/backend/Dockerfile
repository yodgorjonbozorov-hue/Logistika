# Production image for the NestJS API.
#
# Multi-stage on purpose: the runtime image carries the compiled JS, the
# generated Prisma client and production dependencies — no source, no toolchain,
# no dev dependencies, and no .env.
#
# Build from the REPOSITORY ROOT so the pnpm workspace (packages/shared) is
# available:  docker build -f apps/backend/Dockerfile -t truckcontrol-api .

# ---------------------------------------------------------------------------
# Stage 1 — dependencies
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Only the manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter backend... --filter shared...

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend

RUN pnpm --filter shared build \
 && pnpm --filter backend exec prisma generate \
 && pnpm --filter backend build \
 # Re-resolve the tree without dev dependencies for the runtime image.
 && pnpm install --frozen-lockfile --prod --filter backend... --filter shared...

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /repo

# openssl: required by Prisma's query engine.
# curl: used by the container healthcheck below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV API_PORT=3000

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /repo/apps/backend/dist ./apps/backend/dist
COPY --from=build /repo/apps/backend/package.json ./apps/backend/
# Migrations and the seed travel with the image so the migration job runs the
# exact same artefact that serves traffic — never a separately built copy.
COPY --from=build /repo/apps/backend/prisma ./apps/backend/prisma

# Never run as root: a container escape should not start from uid 0.
RUN chown -R node:node /repo
USER node

WORKDIR /repo/apps/backend
EXPOSE 3000

# Readiness, not liveness: the orchestrator should stop sending traffic while a
# dependency is down, and this is the endpoint that actually checks them.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/api/v1/health/ready" || exit 1

# No migrations here: schema changes belong to a separate, one-shot job, not to
# every replica racing each other on startup (see deploy/README.md).
CMD ["node", "dist/main.js"]
