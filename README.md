# Adventurer Manager

A multiplayer web-based business management game where players run adventuring companies — hiring adventurers, accepting contracts, managing properties, and competing for high-value contracts against other players.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+ (`npm install -g pnpm`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Postgres and Redis)
- A [Clerk](https://clerk.com) account (free tier covers development)

## First-time setup

**1. Install dependencies**

```bash
pnpm install
```

**2. Create your environment file**

```bash
cp .env.example .env
```

Open `.env` and fill in your Clerk keys. Everything else works as-is for local development:

```
CLERK_SECRET_KEY=sk_test_...       # from Clerk dashboard → API Keys
CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

The database and Redis URLs are pre-filled to match the Docker Compose services.

**3. Start the database and Redis**

```bash
pnpm docker:up
```

**4. Run database migrations**

```bash
pnpm db:migrate
```

This creates all tables and seeds the initial adventurer/contract pool.

## Running locally

You need two terminals — one for the API, one for the frontend.

**Terminal 1 — API server** (runs on port 3001)

```bash
pnpm dev:api
```

**Terminal 2 — Frontend** (runs on port 5173)

```bash
pnpm dev:frontend
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Workspace structure

```
packages/
  types/      Shared TypeScript types and game logic (adventurer generator, contract templates)
  api/        Express + Prisma backend
    prisma/   Schema, migrations, seed script
    src/
      routes/   REST endpoints (adventurers, contracts, adventures, properties, player)
      services/ Game engine (adventure resolution, wage collection, bootstrap mechanics)
      workers/  pg-boss background jobs (daily reset, market GC, adventure ticker)
      lib/      Prisma client, Redis pub/sub, SSE hub
  frontend/   Vite + React 18 + TypeScript UI
    src/
      pages/    Dashboard, AdventurerMarket, ContractMarket, Properties, Transactions
      components/ AdventurerCard, ContractCard, AdventureTimer
      hooks/    useSSE (real-time updates via Server-Sent Events)
```

## Useful commands

| Command | Description |
|---|---|
| `pnpm docker:up` | Start Postgres + Redis in Docker |
| `pnpm docker:down` | Stop Docker services |
| `pnpm db:migrate` | Apply pending Prisma migrations |
| `pnpm db:studio` | Open Prisma Studio (visual DB browser) |
| `pnpm typecheck` | Type-check all packages |

## Background jobs

The API runs four pg-boss workers automatically on startup:

| Worker | Schedule | Purpose |
|---|---|---|
| `adventureTicker` | Every minute | Resolves completed adventures |
| `wageCollector` | Daily at midnight UTC | Charges wages, handles adventurer quits |
| `marketGC` | Every 15 minutes | Awards bid-won contracts, expires stale listings |
| `dailyReset` | Daily at midnight UTC | Refreshes the adventurer and contract pool |

## Game overview

- **Hire adventurers** from the shared market pool (scales with active player count)
- **Accept contracts** — errand/standard tiers are first-come-first-served; dangerous/legendary use competitive bidding (highest-reputation player wins when the bid window closes)
- **Deploy parties** on adventures; outcome depends on party power vs. required power
- **Pay wages** daily — failure to pay causes adventurers to quit and damages your reputation
- **Reputation gates** higher-level adventurers and dangerous/legendary contracts
- **Bootstrap mechanics** for players who run out of gold: desperate hire (free low-loyalty adventurer) and guild welfare contracts (errand with no failure penalty), both gated on having no roster, no properties, and insufficient gold to hire from the open market
