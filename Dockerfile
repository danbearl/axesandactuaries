FROM node:20-alpine AS base
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
# VITE_CLERK_PUBLISHABLE_KEY is baked into the frontend bundle at build time.
# Pass it as a build arg: fly deploy --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
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
# Copy compiled outputs from build stage
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/frontend/dist ./packages/frontend/dist

EXPOSE 3001
CMD ["node", "packages/api/dist/index.js"]
