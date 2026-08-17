# Multi-stage build for the React app: Vite build, then a static nginx serve.
# Context is the monorepo root (the app imports the shared workspace package):
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://… -t truckcontrol-web .

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter web... --filter shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Vite inlines this at build time — it cannot be changed by the container env.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter shared build && pnpm --filter web build

FROM nginx:1.27-alpine AS runtime
COPY nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
