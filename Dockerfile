FROM node:22-alpine AS base
# Prisma's schema/query engine is a Rust binary that links against the system
# OpenSSL at runtime. node:22-alpine doesn't install it as a system package.
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Install all dependencies (dev + prod, needed to build) ────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY packages/api/package.json ./packages/api/
COPY packages/frontend/package.json ./packages/frontend/
# Prisma schema must be present so prisma generate runs during install
COPY packages/api/prisma ./packages/api/prisma
RUN pnpm install --frozen-lockfile

# ── Build all packages ────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# Re-run prisma generate now that the full source tree is present. The pnpm
# postinstall in the deps stage may write the generated client to a virtual-
# store path that tsc can't resolve; running it here guarantees the output
# lands where the workspace expects it.
RUN pnpm --filter @adventurer-manager/api exec prisma generate
# VITE_CLERK_PUBLISHABLE_KEY and VITE_SENTRY_DSN are baked into the frontend
# bundle at build time. Pass them as build args, e.g.:
# fly deploy --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... --build-arg VITE_SENTRY_DSN=https://...
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_SENTRY_DSN
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN pnpm --filter @adventurer-manager/types build
RUN pnpm --filter @adventurer-manager/frontend build
RUN pnpm --filter @adventurer-manager/api build

# ── Production runtime ────────────────────────────────────────────────────────
FROM base AS runner
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY packages/api/package.json ./packages/api/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/api/prisma ./packages/api/prisma
# Install production deps only (prisma CLI is in prod deps for migrate deploy)
RUN pnpm install --frozen-lockfile --prod
# Generate the Prisma runtime client — postinstall may not locate the schema
# in pnpm's virtual store context, so run it explicitly like the build stage.
RUN pnpm --filter @adventurer-manager/api exec prisma generate
# Copy compiled outputs from build stage
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/frontend/dist ./packages/frontend/dist

EXPOSE 3001
CMD ["node", "packages/api/dist/index.js"]
