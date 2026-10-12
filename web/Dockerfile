# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.34.5
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL="" NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="" NEXT_PUBLIC_GA_MEASUREMENT_ID="" NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN="" NEXT_PUBLIC_POSTHOG_HOST=""
ENV BUILD_STANDALONE=1 DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
RUN pnpm run build

# migrate + worker: full deps (drizzle-kit, tsx are devDependencies)
FROM deps AS tools
COPY . .
ARG UPTEMPO_VERSION=dev
ENV NODE_ENV=production UPTEMPO_VERSION=$UPTEMPO_VERSION
CMD ["pnpm", "run", "worker"]

FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /app
ARG UPTEMPO_VERSION=dev
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_DIR=/data/uploads UPTEMPO_VERSION=$UPTEMPO_VERSION
RUN mkdir -p /data/uploads && chown -R node:node /data /app
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
