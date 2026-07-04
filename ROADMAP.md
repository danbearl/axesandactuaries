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
- Security/compliance baseline (from original TODO.md, Security and Compliance) — a first
  secure-code review pass and documented secure-coding practices, given the app already
  handles real user accounts via Clerk.

## Should Have
- Migrate `@clerk/clerk-react` to `@clerk/react` (2026-07-03) — Clerk's Core 3 release
  (2026-03-03) renamed the package; the old one is no longer supported. Clerk is the app's
  entire auth layer, so this shouldn't sit indefinitely. Clerk provides an `@clerk/upgrade`
  CLI to automate most of the migration; check whether `@clerk/express` (backend) needs any
  Core 3 changes too.
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
