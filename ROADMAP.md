# Axes & Actuaries — Development Roadmap

Reconstructed 2026-07-03 after loss of prior planning artifacts (previous `.claude`
planning files were never committed to git and were lost in a drive failure).
Supersedes `TODO.md`. Reorganized 2026-07-04 from a flat priority list into development
phases, so progress toward beta and general release is visible at a glance.

## Current State
Core game loop is built and live on Fly.io (app `axes-actuaries`), Neon Postgres, Upstash
Redis, Clerk auth, Sentry (API + frontend). Built: adventurer hiring market, tiered contract
market with competitive bidding, adventure deployment/resolution, properties (build/upgrade/
sell), daily wage collection, reputation, full transaction ledger, bootstrap/anti-softlock
mechanics (desperate hire, welfare contracts), real-time updates via Redis pub/sub + SSE, 3
pg-boss background workers. CSP is enforcing in production; the app is currently ready to
open to a small trusted player pool (Phase 0 below).

## Development Phases

1. **Phase 0 — Pre-Beta Hardening** — done, small trusted pool
2. **Beta Phase 1 — UX & Onboarding**
3. **Beta Phase 2 — Game Mechanics Depth**
4. **Beta Phase 3 — Player Customization**
5. **Gate — Trusted Pool → Expanded Pool**
6. **Beta Phase 4 — Social Features** — beta concludes here → general release
7. **Post-Beta — Regions & World Map**
8. **Post-Beta — Infrastructure Maturity**
9. **Post-Beta — Monetization**

---

## Phase 0 — Pre-Beta Hardening
**Goal:** the app is safe and stable enough to open to a small trusted pool of real players
(friends/family). **Status: complete**, aside from minor cleanup below.

- [x] Fix GitHub Actions deploy trigger (2026-07-03) — `deploy.yml` was firing on push to
  `main`, which doesn't exist on this repo (branches are `dev`/`master`); confirmed all
  deploys to date were manual `flyctl deploy`. Retargeted trigger to `master`.
- [x] CI gate before deploy (2026-07-03) — added a `verify` job (typecheck + test) that
  `deploy` now `needs`, gated to `push` events only. Verified locally and passing.
- [x] Automated tests for core economic logic (2026-07-03) — Vitest across `packages/types`
  (pure logic: leveling, hire/wage cost, generation) and `packages/api` (wage collection,
  back-wage repayment, quit rolls, adventure resolution, bootstrap thresholds, market GC bid
  awarding) against a real ephemeral Postgres, wired into CI. Route-level/HTTP integration
  tests (Clerk-authenticated endpoints) remain a gap — see Infrastructure Maturity phase.
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
  real-time events were silently never delivered. Added `helmet` for security headers. Ran
  `pnpm audit`: found and fixed a **high-severity authorization bypass** in
  `@clerk/clerk-react` (GHSA-w24r-5266-9c3c, patched >=5.61.6, a same-major bump applied
  immediately) — separate from the `@clerk/react` Core 3 rename below. Also found a
  **moderate** unbounded-memory-allocation bug in `@opentelemetry/core` (GHSA-8988-4f7v-96qf,
  transitive via `@sentry/node`), fixed below.
- [x] Upgrade `@sentry/node` v8 → v10 (2026-07-04) — resolves the `@opentelemetry/core`
  unbounded-memory-allocation CVE (GHSA-8988-4f7v-96qf, moderate); v10 is where Sentry
  bumped its OpenTelemetry dependency to v2.x (v9 doesn't reach it). Reviewed both the
  v8→v9 and v9→v10 breaking-change sets (removed `getCurrentHub`/`Hub`/`BaseClient`,
  renamed integration, `setUser`-based user context) — none touch this codebase's minimal
  `Sentry.init()`/`setupExpressErrorHandler()` usage, so skipped the intermediate v9 stop
  rather than doing two upgrade passes. Verified: `pnpm test`/`typecheck` pass, `pnpm audit`
  no longer reports the CVE, and a live `pnpm dev:api` smoke test confirmed clean startup.
- [x] Content-Security-Policy tuning (2026-07-04) — deployed in Report-Only mode first
  (logs violations to the browser console without blocking anything), verified against real
  production traffic (signed in through Clerk's hosted `<SignIn>`, browsed multiple pages)
  with zero policy violations, then switched to enforcing. Directives cover Clerk's custom
  FAPI domain (`clerk.axesandactuaries.com`), Google Fonts, Sentry's ingest endpoint, and
  `'unsafe-inline'` for both Clerk's own styling and this app's inline `style={{}}` usage.
  Only ever exercised by production traffic (Express serves `helmet` headers only under
  `NODE_ENV=production`; local Vite dev never goes through this middleware).
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
- [x] Fix SSE query-key mismatch (2026-07-04) — `useSSE.ts`'s `market_update` handler
  invalidated React Query key `['market-adventurers']`, which matched nothing; the Adventurer
  Market page's real key is `['adventurers', 'market']`. Fixed to prefix-match `['adventurers']`,
  consistent with how every other handler in the file invalidates.

**Minor cleanup — complete (2026-07-04):**
- [x] Deleted unused `packages/frontend/src/data/mockData.ts` (confirmed zero references).
- [x] Fixed README's worker table — it documented a separate `wageCollector` worker that
  never existed as its own worker; wage/maintenance collection has always run inside
  `dailyReset` (the code comment already said so: "midnight UTC (wages + maintenance +
  market refresh)"). Corrected to the real 3 workers. Also caught and fixed a stale
  "Node.js 20+" in Prerequisites while in there.
- [x] Renamed package scope `@adventurer-manager/*` → `@axes-actuaries/*` (root + all three
  workspace packages, every import across `packages/api` and `packages/frontend`, the
  Vitest alias in `packages/api/vitest.config.ts`, `Dockerfile`, and
  `.github/workflows/deploy.yml`) to match the product name and Fly app name. Deliberately
  left the local dev database name (`adventurer_manager`) and docker-compose
  user/db credentials unchanged — renaming those would require an actual data migration for
  anyone with a local Postgres volume already created, which is out of scope for a package
  naming cleanup.

---

## Beta Phase 1 — UX & Onboarding
**Goal:** the app is pleasant and self-explanatory for a first-time trusted-pool player.

- [x] Move "Sign Out" out of the sidebar footer (2026-07-05) — added a top-of-sidebar user
  menu: the player name in `nav-player-card` is now a clickable dropdown trigger (with
  click-outside-to-close and basic `aria-haspopup`/`aria-expanded`/`role="menu"` support)
  containing Sign Out, moved out of the old bottom-of-sidebar footer. Gold/reputation stats
  stay always-visible below it rather than hidden behind the menu, since those are
  glanced at frequently. Built as a genuinely extensible menu (not a single hardcoded
  button) so future items (profile, settings, etc.) can be added as the app grows.
  Verified in a real browser: open/close, click-outside-close, and Sign Out all confirmed
  working.
- [x] Player profile pages (2026-07-05) — self-view only for now (no way to browse *other*
  players yet; that's gated to Beta Phase 4, Social Features, once there's a reason to
  discover other players at all). Distinct from Dashboard's live/operational view: a new
  `GET /api/v1/player/profile` route + `services/profile.ts` (`getPlayerProfileStats`)
  computes lifetime/career stats from the permanent Transaction/Adventure history —
  adventures completed/failed (+ success rate), lifetime gold earned, adventurers hired
  (paid hires only; desperate/free hires don't record a `hire_cost` transaction, documented
  in code). New `Profile.tsx` page at `/profile`, linked from the nav user menu added just
  before this. Unit-tested (`test/profile.test.ts`) and verified end-to-end in a real
  browser.
- [x] Adventurer profile pages (2026-07-05) — new `GET /api/v1/adventurers/:id`
  (ownership-scoped, same pattern as `/fire`) + `services/adventurerHistory.ts` computing
  total/completed/failed adventure counts and a recent-contracts list via the
  `AdventureAdventurer` join. `AdventurerDetail.tsx` at `/adventurers/:id` reuses the
  existing full `AdventurerCard` component for name/class/race/stats/personality
  (guarantees visual consistency with the hire-market tiles — literally the same
  component), adds a level-progress bar using the actual non-linear `XP_TO_LEVEL` table
  (not the simplified approximation `AdventurerCard`'s own "XP to Next" footer uses), a
  live injury-recovery countdown, and the career-record stats. Reachable by clicking an
  adventurer in the Dashboard roster — `AdventurerCard`'s compact variant gained an
  optional `onClick`, with the existing "Release" button calling `stopPropagation()` so it
  doesn't also trigger navigation. Unit-tested and verified end-to-end in a real browser.
- Wiki/documentation pages for races, classes, characteristics (from original TODO.md,
  Aesthetics/UX).
- New player onboarding (2026-07-05) — a first-login page prompting for a user handle and
  guild name. This replaces the current silent behavior in `routes/auth.ts`, which
  auto-generates `username` from Clerk profile data with no prompt at all today, and needs
  a new `guildName` field added to the `Player` model (schema migration) — there's no
  "guild name" concept in the schema yet, only `username`. **Scope for this phase is just
  the handle/guild-name prompt.** The rest of the onboarding vision has real dependencies on
  work that hasn't landed yet, so it's deliberately not bundled in now:
  - *Initial customizations* — blocked on Beta Phase 3 (Player Customization); there's no
    cosmetics/avatar infrastructure to customize yet.
  - *UI walkthrough* — sequence toward the end of this phase, after Sign Out relocation and
    the profile pages above land, so it isn't built against UI that's still moving within
    this same phase.
  - *Region selection* — blocked on Post-Beta "Regions & World Map"; the game is currently
    single-region, so there's nothing to select. Not schedulable against any phase with a
    committed timeline yet.
  - *Game tutorial* — a basic version covering the stable core loop (hire → contract →
    adventure → property) could reasonably ship late in this phase; a fuller version
    covering newer mechanics should wait for Beta Phase 2 (Game Mechanics Depth) to land
    first, since teaching mechanics that are about to deepen would mean redoing it.
- Whatever other UX friction surfaces from real trusted-pool usage — this phase should stay
  open to feedback-driven items, not just the list above.

## Beta Phase 2 — Game Mechanics Depth
**Goal:** the core loop is deep and balanced enough to hold a trusted pool's attention.

- Contract completion reports (from original TODO.md, Game Mechanics).
- Vacation Mode (from original TODO.md, Game Mechanics) — pause wage/maintenance collection
  without penalty; retention feature for a live player base.
- Ranking and Achievements (from original TODO.md, Gamification) — core retention loop.
- Adventurer equipment system (from original TODO.md, Game Mechanics).
- Contract class/stat requirements — a `requiredStats` field already exists as a stub in
  `packages/types/src/contracts.ts` marked "reserved for Phase 5."
- Dorm-space-based adventurer limits; party size limits (from original TODO.md, Game
  Mechanics).
- Deeper personality-stat effects — granular Loyalty/Ambition/Disposition mechanics (from
  original TODO.md, Game Mechanics).

## Beta Phase 3 — Player Customization
**Goal:** players have meaningful ways to express/personalize their guild once retention is
already working.

- Adventurer portraits (from original TODO.md, Aesthetics/UX) — head shots, full body,
  customizable, random with low duplicate chance.
- Visual base/property representation (from original TODO.md, Aesthetics/UX).
- Titles, badges, property/adventurer cosmetic customization (from original TODO.md,
  Gamification).
- Full custom/rare player avatar system (from original TODO.md, Social Elements /
  Gamification) — more speculative/lower-priority within this phase; depends on the
  cosmetics infrastructure above landing first.

---

## Gate — Trusted Pool → Expanded Pool
**Goal:** before opening beta beyond the initial trusted pool to a broader audience, these
must land — they're what makes it safe to let strangers in.

- Admin/Moderator roles (from original TODO.md, Administrative) — no privileged access
  model exists yet; needed before opening to players you don't know personally.
- Abuse-prevention foundations (from original TODO.md, Social Elements) — needed before any
  player-to-player feature ships, which is exactly what Beta Phase 4 introduces.
- U.S./E.U. privacy regulatory compliance review (from original TODO.md, Security and
  Compliance) — not a blocker for a small known-personally pool, but needed before wider
  acquisition.
- Redis-backed rate limiting — replace in-memory `express-rate-limit` with Upstash-backed
  limiting (won't survive horizontal scaling; Redis is already paid for and only used for
  pub/sub today). Scale risk goes up with a broader pool.

## Beta Phase 4 — Social Features
**Goal:** player-to-player interaction works safely at small scale. **Beta concludes here —
completing this phase (with the Gate above already cleared) means the app is feature-complete
enough for general release.**

- Player-to-player messaging, trades, message board (from original TODO.md, Social
  Elements).
- Social-facing profile page elements (extending Beta Phase 1's profile pages once the Gate
  above has landed).

---

## Post-Beta — Regions & World Map
**Goal:** post-general-release expansion of the game world. Pulled into its own phase given
explicitly large scope — bundling it with Beta Phase 2 would make that phase's completion
criteria fuzzy.

- Multi-region play / world map (from original TODO.md, Game Mechanics): multiple regions,
  different flavors/difficulty per region, region-specific adventurer pools, players must
  expand to a region (build an office) before operating there, world map UI.
- Legendary-contract story elements affecting the game world (from original TODO.md, Game
  Mechanics) — grouped here rather than Beta Phase 2 since "affecting the game world"
  presumes a persistent multi-region world state to affect.
- Multi-region expansion beyond the initial single-region design, until the single-region
  core game loop is proven with real players (from original TODO.md Won't Have — still
  applies until this phase is reached).

## Post-Beta — Infrastructure Maturity
**Goal:** the platform holds up under real scale and ongoing maintenance, not just a beta
pool.

- Route-level/HTTP integration test coverage (Clerk-authenticated endpoints) — flagged as a
  gap when the Pre-Beta automated-tests item shipped; current coverage is service/worker
  functions only.
- An actual Docker-build verification step in CI — today CI runs typecheck/test but never
  builds the production Docker image; the *first* time it's ever built is during
  `flyctl deploy` itself in production. This exact gap already caused a scare during the
  Node 22/Prisma 6.1 upgrade (see Pre-Beta) and is worth closing before it causes a real
  outage.
- Broader observability beyond Sentry error monitoring (e.g. dashboards/alerting on top of
  existing Sentry data, database/Redis health metrics).

## Post-Beta — Monetization
**Goal:** sustainable revenue, attempted only once retention is proven post-general-release.

- Ads, subscriptions, cosmetic purchases, season passes (from original TODO.md,
  Monetization). The original list itself frames these as open questions ("Ads? Subscription
  – what's the benefit?") — expect this phase to start with research/decisions, not
  implementation.
