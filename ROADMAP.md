# Axes & Actuaries — Development Roadmap

Reconstructed 2026-07-03 after loss of prior planning artifacts (previous `.claude`
planning files were never committed to git and were lost in a drive failure).
Supersedes `TODO.md`.

## Current State (as of this roadmap)
Core game loop is built and live in beta on Fly.io (app `axes-actuaries`), Neon Postgres,
Upstash Redis, Clerk auth, Sentry (API-side). Built: adventurer hiring market, tiered
contract market with competitive bidding, adventure deployment/resolution, properties
(build/upgrade/sell), daily wage collection, reputation, full transaction ledger,
bootstrap/anti-softlock mechanics (desperate hire, welfare contracts), real-time updates
via Redis pub/sub + SSE, 3 pg-boss background workers.

## Must Have
- [x] Fix GitHub Actions deploy trigger (2026-07-03) — `deploy.yml` was firing on push to
  `main`, which doesn't exist on this repo (branches are `dev`/`master`); confirmed all
  deploys to date were manual `flyctl deploy`. Retargeted trigger to `master`.
- [x] CI gate before deploy (2026-07-03) — added a `verify` job (typecheck + test) that
  `deploy` now `needs`, gated to `push` events only. Verified locally and passing.
- [x] Automated tests for core economic logic (2026-07-03) — Vitest across `packages/types`
  (pure logic: leveling, hire/wage cost, generation) and `packages/api` (wage collection,
  back-wage repayment, quit rolls, adventure resolution, bootstrap thresholds, market GC bid
  awarding) against a real ephemeral Postgres, wired into CI. Route-level/HTTP integration
  tests (Clerk-authenticated endpoints) remain a follow-up, not yet covered.
- [x] Upgrade Node 20 to Node 22 LTS (2026-07-03) — Node 20 ("Iron") was past end-of-life
  (April 2026). Bumped `Dockerfile`, `.github/workflows/deploy.yml`, `package.json` engines,
  and `.nvmrc` to Node 22. Along the way, discovered Node 22/24's Alpine base (3.21+) trips a
  Prisma bug where it fails to detect libssl/OpenSSL and crashes on startup (prisma/prisma
  #25817), which the pinned `prisma@^5.22.0` couldn't reach the fix for — bumped
  `prisma`/`@prisma/client` to `^6.1.0` (the release that fixed it) in the same change.
  Verified: `pnpm typecheck`/`pnpm test` pass, and a full `docker build` + `docker run`
  confirmed the API starts cleanly under Node 22 with no OpenSSL detection error.
- [x] Exploitation prevention (2026-07-03) — audited the route handlers for TOCTOU races
  (check-then-act gaps a player can exploit by firing concurrent requests) and fixed three:
  (1) contract double-fulfillment via `POST /adventures` — racing it let a player start
  multiple Adventures against one awarded contract, each paying out independently on
  resolution (direct gold/reputation duplication), and could double-book an adventurer onto
  two adventures at once; (2) welfare-contract cooldown bypass — unlimited free welfare
  contracts via concurrent `POST /contracts/welfare/accept`; (3) desperate-hire farming —
  unlimited free adventurers via concurrent `POST /adventurers/desperate-hire`. Fixed #1/#2
  with the atomic `updateMany`-claim pattern already used elsewhere in this codebase
  (`/adventurers/:id/hire`, `/contracts/:id/accept`); #3 has no single row to gate an atomic
  claim on (eligibility is a derived count), so it uses a Postgres `Serializable` transaction
  instead. Extracted the claim logic into `services/adventure.ts` (`startAdventure`) and
  `services/bootstrap.ts` (`claimWelfareContract`, `claimDesperateHire`) so routes stay thin
  and the fixes are unit-testable; added concurrent-request regression tests for all three.
- [x] Frontend error monitoring (2026-07-03) — added `@sentry/react` to `packages/frontend`,
  initialized in `main.tsx` (DSN-gated, mirroring the API's `enabled: !!dsn` pattern) with an
  `ErrorBoundary` around the app for React render errors. `VITE_SENTRY_DSN` flows through as
  a build-arg (`Dockerfile`, `.github/workflows/deploy.yml`, GitHub Actions secret) the same
  way `VITE_CLERK_PUBLISHABLE_KEY` already does — it's baked into the bundle at build time,
  not a Fly runtime secret. Used a separate Sentry project from the API's (different noise
  profile: browser/extension errors vs. server errors). Verified end-to-end: a real error
  triggered in the running app showed up in the Sentry issue feed.
- [x] Security/compliance baseline (2026-07-03) — audited the API for the OWASP-adjacent
  basics (secrets handling, CORS, security headers, error-message leakage, IDOR/ownership
  checks, XSS in the frontend) and wrote `SECURITY.md` documenting the patterns this
  codebase relies on (atomic-claim pattern for concurrency, `requireAuth`+ownership checks,
  secrets/env handling) for future contributors. Found and fixed a real bug along the way:
  `routes/events.ts` was the one route hand-rolling its own auth check instead of using
  `requireAuth`, and that inconsistency hid a bug where SSE connections were keyed by the
  raw Clerk `userId` while every publisher used the internal `player.id` — per-player
  real-time events were silently never delivered. Added `helmet` for security headers
  (CSP deliberately left off pending real-browser verification against Clerk's hosted UI
  and the frontend's inline `style` usage — see `SECURITY.md`). Ran `pnpm audit`: found and
  fixed a **high-severity authorization bypass** in `@clerk/clerk-react` (GHSA-w24r-5266-9c3c,
  patched >=5.61.6, a same-major bump applied immediately) — separate from the `@clerk/react`
  Core 3 rename already tracked below. Also found a **moderate** unbounded-memory-allocation
  bug in `@opentelemetry/core` (GHSA-8988-4f7v-96qf, transitive via `@sentry/node`) that
  can't be fixed with a same-major bump — `@sentry/node@8.x` is built against OpenTelemetry
  v1.x internally, and OTel v2 support only landed in `@sentry/node@10.x`. Tracked as its
  own item below rather than forced/overridden blind.
- Upgrade `@sentry/node` past v8 (v9 or v10) to resolve the `@opentelemetry/core`
  unbounded-memory-allocation CVE (GHSA-8988-4f7v-96qf, moderate) — needs its own review
  pass for breaking changes (like the Prisma and Clerk Core 3 upgrades), not a blind
  dependency override, since `@sentry/node@8.x`'s tracing internals are built against
  OpenTelemetry v1.x and can't reach the patched `@opentelemetry/core@2.8.0+` within the
  same major version.
- Content-Security-Policy tuning — `helmet`'s CSP is currently disabled; needs a policy
  written and verified against a real browser for Clerk's hosted `<SignIn>` component and
  the frontend's extensive inline `style={{}}` usage before enabling.

## Should Have
- [x] Migrate `@clerk/clerk-react` to `@clerk/react` (2026-07-03) — Clerk's Core 3 release
  (2026-03-03) renamed the package. `@clerk/express` (backend) was **not** renamed in Core 3,
  so this was frontend-only. More than an import path change: `<SignedIn>`/`<SignedOut>`/
  `<Protect>` were fully removed (not just deprecated) in favor of a single `<Show when="...">`
  component — updated `App.tsx` accordingly (`main.tsx`, `useSSE.ts`, `Navigation.tsx` only
  needed the import path updated, since `ClerkProvider`/`useAuth`/`useClerk` kept their APIs).
  Verified end-to-end in a real browser: sign-in, dashboard load, and sign-out all confirmed
  working. Along the way, found and fixed an unrelated pre-existing bug this verification
  surfaced: `tsx` (the API's dev runner) does not actually auto-load `.env` files — a false
  assumption made earlier in this reconstruction — so `pnpm dev:api` had never worked with
  real env vars via `.env`. Added `dotenv` and an `import 'dotenv/config'` as the first line
  of `src/index.ts` and `prisma/seed.ts` (no-op in production, where Fly injects real env vars
  directly). CI/tests were unaffected — they already set `DATABASE_URL` explicitly, bypassing
  `.env` entirely.
- Redis-backed rate limiting — replace in-memory `express-rate-limit` with Upstash-backed
  limiting (currently won't survive horizontal scaling; Redis is already paid for and only
  used for pub/sub today).
- Admin/Moderator roles (from original TODO.md, Administrative) — no privileged access
  model exists yet; needed as the player base grows.
- Contract completion reports (from original TODO.md, Game Mechanics).
- Vacation Mode (from original TODO.md, Game Mechanics) — pause wage/maintenance collection
  without penalty; retention feature for a live player base.
- Player profile pages (from original TODO.md, Social Elements — profile only, not
  messaging/trades yet).
- Adventurer profile pages (from original TODO.md, Aesthetics/UX).
- Ranking and Achievements (from original TODO.md, Gamification) — core retention loop.
- Abuse-prevention foundations (from original TODO.md, Social Elements) — needed before any
  player-to-player feature ships.
- Housekeeping: delete unused `packages/frontend/src/data/mockData.ts`; reconcile README's
  documented worker list (4) against the 3 actually registered in `workers/index.ts`; align
  package scope/branding (`@adventurer-manager/*` vs. product name "Axes & Actuaries").
- U.S./E.U. privacy regulatory compliance review (from original TODO.md, Security and
  Compliance) — not blocking current small beta, but needed before wider acquisition.

## Could Have
- Player-to-player messaging, trades, message board (from original TODO.md, Social Elements).
- Titles, badges, property/adventurer cosmetic customization (from original TODO.md,
  Gamification).
- Adventurer equipment system (from original TODO.md, Game Mechanics).
- Contract class/stat requirements — a `requiredStats` field already exists as a stub in
  `packages/types/src/contracts.ts` marked "reserved for Phase 5."
- Dorm-space-based adventurer limits; party size limits (from original TODO.md, Game
  Mechanics).
- Deeper personality-stat effects — granular Loyalty/Ambition/Disposition mechanics (from
  original TODO.md, Game Mechanics).
- Visual base/property representation; adventurer portraits (from original TODO.md,
  Aesthetics/UX).
- Wiki/documentation pages for races, classes, characteristics (from original TODO.md,
  Aesthetics/UX).
- Multi-region play / world map (from original TODO.md, Game Mechanics) — large scope.
- Legendary-contract story elements affecting the game world (from original TODO.md, Game
  Mechanics).

## Won't Have (this horizon)
- Monetization — ads, subscriptions, cosmetic purchases, season passes (from original
  TODO.md, Monetization). The original list itself frames these as open questions; premature
  before retention is proven with a small live beta.
- Full custom/rare player avatar system (from original TODO.md, Social Elements /
  Gamification) — depends on cosmetics infrastructure not yet built.
- Multi-region expansion beyond the initial single-region design, until the single-region
  core game loop is proven with real players.
