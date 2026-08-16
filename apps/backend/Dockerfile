# Backend image. Built from the repo root so the workspace and the shared
# package come along: `docker build -f apps/backend/Dockerfile .`
FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/backend apps/backend

# `pnpm deploy` copies the package with only its production dependencies, as
# real directories — the built dist/ and prisma/ come along with it. The Prisma
# CLI is a runtime dependency on purpose: migrations are applied at start.
RUN pnpm --filter shared build \
 && pnpm --filter backend exec prisma generate \
 && pnpm --filter backend build \
 && pnpm --filter backend --prod deploy /out

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /out /app

USER node
EXPOSE 3000
# `migrate deploy` only applies committed migrations — it never generates one.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
