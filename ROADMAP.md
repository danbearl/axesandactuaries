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
- [x] Fix Redis pub/sub (2026-07-05) — while retesting the hire-adventurer race-condition
  fix, found that a second player's market view never updated in real time no matter how
  long they waited. Root cause turned out to be much bigger than that one test: **Redis
  pub/sub had never successfully connected in production at all**. Fly logs showed
  continuous `ECONNRESET`/`EPIPE`/"max retries per request limit" errors and
  `Redis/SSE init failed: Error: Connection is closed` — meaning `sseHub.start()` never
  even ran, so *no* SSE event of any kind (market GC/daily-reset broadcasts included, not
  just the new hire/fire/accept/bid publishes below) had ever been delivered. Cause: the
  Upstash Redis instance was set up using its **REST** connection details instead of
  **TCP** — this app uses `ioredis` (a TCP-protocol client) for persistent pub/sub
  subscriptions, which Upstash's REST API fundamentally cannot support (it's a stateless
  HTTP request/response interface, incompatible with a subscriber that needs to receive
  asynchronously pushed messages). Fixed by resetting the `REDIS_URL` Fly secret to
  Upstash's TCP connection string using the TLS scheme (`rediss://`, not `redis://` —
  Upstash's TCP endpoint requires TLS, and connecting without it produces this exact
  `ECONNRESET`/retry-limit error signature). Verified via Fly logs (`[redis] Connected`,
  `[sse-hub] Listening on Redis channels`, no further errors) and a real two-browser test:
  the market now updates within about a second when another player acts, not just on
  reload.
- [x] Publish `market_update` on hire/fire/contract-accept/contract-bid (2026-07-05) — these
  direct player actions never broadcast anything before; only the periodic
  `marketGC`/`dailyReset` workers did, so another player's market view had no guaranteed
  refresh window at all after someone else acted (this is what surfaced the Redis bug
  above). Now publishes the same way `marketGC`/`dailyReset` already do.

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

**Trusted-pool access gate:**
- [x] Clerk "Restricted" sign-up mode (2026-07-05) — gates sign-ups to admin-added users
  only for the initial trusted-pool stage. Zero code changes, configured entirely in Clerk
  Dashboard, and not paywalled (unlike the separate email-Allowlist feature considered
  first, which requires a paid plan in production). Distinct from the invite-code system
  planned at the Trusted Pool → Expanded Pool gate, which is a player-driven growth
  mechanic rather than an admin-curated list.

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
- [x] Wiki/documentation pages for heritages, vocations, characteristics (2026-07-05) —
  freeform CMS-style pages rather than structured per-category content, and edited via
  `pnpm db:studio` directly rather than an in-app editor, both deliberate scope calls to
  avoid building throwaway admin scaffolding ahead of the future Admin/Moderator roles
  feature (Gate phase). New `WikiPage` Prisma model (`slug`, `title`, `body`, `order`) +
  `GET /api/v1/wiki` (index) and `GET /api/v1/wiki/:slug` routes, both behind `requireAuth`,
  no dedicated service/test layer (matches the existing simple-Prisma-query convention of
  `routes/player.ts`'s `/me` and `routes/transactions.ts`). `Wiki.tsx` at `/wiki` and
  `/wiki/:slug`, two-column layout (page nav + content), renders body Markdown via
  `react-markdown` + `remark-gfm` (GFM needed specifically for the Vocations page's table —
  core CommonMark alone rendered it as literal pipe characters, caught in browser testing).
  Starter content (Heritages, Vocations, Characteristics) seeded via a new standalone
  `prisma/seedWiki.ts` script (`pnpm db:seed:wiki`), deliberately split out of the main
  `prisma/seed.ts` since that script also wipes/regenerates the live adventurer/contract
  market pool — unsafe to ever run against production. `seedWiki` only creates missing
  slugs, so re-running it never clobbers content later edited via Prisma Studio, and it's
  intended to be run once against the production `DATABASE_URL` after the `wiki_pages`
  table exists there (created automatically by the `release_command`'s `prisma migrate
  deploy`, but not seeded automatically). Verified end-to-end in a real browser.
- [x] New player onboarding (2026-07-06) — a first-login page prompting for a user handle
  and guild name. New nullable `guildName` field on `Player`; its absence is what gates the
  app into the onboarding form (in `App.tsx`, checked right after `player.me()` loads,
  before `Navigation`/routes render), which also means every player who signed up before
  this feature existed hits the prompt once retroactively — an intentional, low-cost way to
  backfill guild names without a separate migration/backfill script. `auth.ts`'s existing
  `/sync` route is unchanged and still auto-creates a placeholder `username` on first login
  (so the player row + starting-gold transaction exist immediately); the new `PATCH
  /api/v1/player/onboarding` route (`player.ts`) is what actually lets the player set their
  real handle and guild name, validated for length and safe characters via a shared
  `NAME_PATTERN` regex, with a username-uniqueness check excluding the player's own row.
  `Onboarding.tsx` pre-fills the handle field with that placeholder (editable) and requires
  a guild name; on submit it invalidates the `['player']` query, which naturally drops the
  player into the normal app once `guildName` is set. Not unit-tested — consistent with this
  codebase's convention of no HTTP route-level tests anywhere in the suite (only
  service-layer logic gets Vitest coverage); this route is a thin validate-then-update, same
  tier as `/me`/`/transactions`/`/wiki`. Verified end-to-end in a real browser, including
  against a pre-existing player account hitting the retroactive prompt.
  **Scope for this phase is just the handle/guild-name prompt.** The rest of the onboarding
  vision has real dependencies on work that hasn't landed yet, so it's deliberately not
  bundled in now:
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

- [x] Contract completion reports (2026-07-06) — new **Adventure Log** tab (📔, between
  Properties and Ledger), a paginated journal (`GET /api/v1/adventures/history?limit=&offset=`,
  default 20/page capped at 50, resolved-only, newest first, mirroring the existing
  `TransactionsResponse` pagination shape) listing every completed/failed adventure by
  contract title and completion date. Clicking a row opens the existing `/adventures/:id`
  page (`AdventureDetail.tsx`), which gained a new "Party Report" section for resolved
  adventures showing each adventurer's XP gained and outcome (unharmed / injured with
  recovery hours / died). This required persisting per-adventurer outcome data that
  previously only existed transiently inside `resolveAdventure`'s loop — the `Adventurer`
  row only ever reflects *current* state, so a later adventure or recovery would silently
  overwrite history. New `xpGained`/`injured`/`died`/`recoveryHours` columns on the existing
  `AdventureAdventurer` join table (rather than a new model) capture that snapshot at
  resolution time. Added the `badge-status-completed`/`failed`/`in_progress` CSS classes,
  which were referenced in `AdventureDetail.tsx` since it was first built but never actually
  defined anywhere. Test-covered in `test/adventure.test.ts` (already the home of
  `resolveAdventure`'s tests) and verified end-to-end in a real browser.
- [x] Admin testing toolkit (2026-07-06) — added ahead of the original phase list, at the
  user's request, to make manual QA faster. Deliberately narrower than the Gate phase's
  planned Admin/Moderator roles system below (that one's about community moderation —
  banning, content review; this is just a debug toolkit): new `isAdmin` boolean on `Player`
  (default `false`, granted only via direct DB access — `pnpm db:studio` or a `players`
  table SQL update in the Neon console — no self-service promotion path). New `requireAdmin`
  middleware (403s non-admins) gates a `/api/v1/admin` router: `GET /players`, `PATCH
  /players/:id` (sets gold/reputation to absolute values; gold changes are logged as an
  `admin_adjustment` transaction — new value added to both the Prisma `TransactionReason`
  enum and the `packages/types` TS union — so the ledger stays reconcilable), `GET
  /adventures?status=`, `POST /adventures/:id/resolve`. `resolveAdventure` gained an
  optional `{ forceOutcome }` param that bypasses the completion timer and the
  success-chance roll while still running the normal injury/death/XP logic against whatever
  outcome is forced, so a forced failure still produces realistic injury/death results to
  test against (test-covered in `test/adventure.test.ts`). New **Admin** nav tab (🛠,
  visible only when `isAdmin`) with two panels: force-resolve any player's in-progress
  adventures, and adjust any player's gold/reputation by username. Verified end-to-end in a
  real browser in both local dev and production (including promoting the production user
  via the Neon console directly).
- Announcements / newsletter feature (2026-07-06) — lets an admin publish game updates,
  balance changes, and general announcements that all players see in-game, rather than
  relying on out-of-band channels. Natural fit once scoped: reuse the existing `isAdmin`
  flag and Admin panel (`routes/admin.ts` / `pages/Admin.tsx`) for authoring, the same way
  the admin testing toolkit does — no need to wait for the full Gate-phase Admin/Moderator
  roles system just to let the one admin post updates. Likely a freeform, Markdown-rendered
  content model similar to the Wiki feature (`react-markdown` is already a frontend
  dependency), but feed-style (reverse-chronological, timestamped entries) rather than the
  Wiki's static reference pages. Open questions to resolve when this gets scoped for real:
  - Read/unread tracking per player, or just a simple public feed everyone sees the same way?
  - Should posting a new announcement push a real-time notification via the existing SSE
    infrastructure (`lib/sse.ts`), or is players noticing it next time they open the app
    (e.g. a nav badge) good enough?
  - Dismissible/pinned entries, or a plain unbounded feed (would eventually want the same
    kind of pagination the Adventure Log already uses)?
  - Where does it live in the nav — its own tab, or folded into an existing one (Dashboard
    banner, Wiki)?
- [x] Daily reset countdown (2026-07-06) — quality-of-life addition from player feedback, to
  help plan cashflow around when wages/maintenance get collected. New `DailyResetTimer`
  component (`components/DailyResetTimer.tsx`), a self-contained live countdown (ticks every
  second, no API calls) to the next `00:00 UTC` — the exact instant the `daily-reset` cron
  job runs (`workers/index.ts`'s `0 0 * * *` schedule). Added as a third line in the
  Dashboard's existing Treasury summary card, alongside the burn-rate/runway line. Verified
  in a real browser.
- [x] Anti-snowball mechanics (2026-07-06) — player feedback that hiring/growth snowballed
  too fast in the first couple of days, turning the game into a mechanical process rather
  than a strategic one. Evaluated five proposed levers plus two more; built the batch
  identified as highest-impact/lowest-interaction-risk (deferred: level-gated contract tiers
  and wage/reward margin tuning, both flagged as needing follow-up once there's real data
  against this batch to tune against):
  - **Roster cap** — `computeRosterCap(dormitoryLevel)` in `packages/types`: 4 base, +4 per
    dormitory level, capping at 16 with a maxed (level 3) dormitory. Enforced in the hire
    route; surfaced in the UI on the Dashboard's Roster card (`X / Y`) and the Hire
    Adventurers market (toolbar stat, a banner, and disabled Hire buttons once full).
  - **XP split across the party** — `resolveAdventure` now divides `rewardGold × 0.1` by
    party size instead of granting every member the full amount, removing the incentive to
    stuff parties with bodies purely to multi-level in parallel.
  - **Injury/death risk on success** — previously injury/death could only happen on
    failure, meaning zero risk at all once a party outscaled its targets. New baseline 8%
    injury chance even on a clean win (vs. 40% on failure), both reduced by Infirmary level
    and floored above zero. While in there, also fixed a latent bug: death used to be a
    fixed roll cutoff (`< 0.1`) that could exceed the injury chance itself at high Infirmary
    levels, making virtually all injuries fatal — now expressed as a share *of* the injury
    chance (25%) so it scales consistently regardless of the base rate or Infirmary discount.
  - **Mandatory rest window** — a healthy, uninjured return now gets a `restUntil`
    timestamp (25% of the contract's own duration) before redeployment, closing the
    "instant redeploy" loop that let a roster snowball throughput with zero pacing cost.
    Surfaced as a "Resting" badge on the adventurer card, excluded from deploy-party
    pickers.

  All service-layer logic test-covered in `test/adventure.test.ts` (XP split, success-path
  injury, rest-window enforcement in `startAdventure`) and verified end-to-end in a real
  browser.

  **Bug found and fixed during verification**: selecting a resting adventurer in
  `ContractMarket.tsx`'s deploy modal correctly blocked the deploy, but the contract had
  *already* been accepted server-side by that point (its combined `acceptMutation` called
  `POST /contracts/:id/accept` then `POST /adventures` as one step) — retrying inside the
  same modal re-called `accept` on an already-awarded contract, 409ing with "Contract is no
  longer available" and leaving the player stuck (their only escape was closing the dialog
  and deploying from the Dashboard's "Contracts Awaiting Deployment" section instead, where
  the equivalent flow only ever calls `start`, never `accept`). This also meant welfare
  contracts — created pre-awarded — would have hit the identical bug on *every* deploy
  attempt, not just this one. Fixed by splitting `ContractMarket.tsx` into separate
  `acceptMutation`/`deployMutation` mutations, skipping accept entirely when the
  (possibly locally-refreshed) contract is already non-`available`, and excluding resting
  adventurers from the deploy modal's selectable list in the first place (mirroring the
  same `isDeployable` filter already added to `Dashboard.tsx`'s modal).

  **Follow-up**: added a `RestStatus` panel to the adventurer profile page
  (`AdventurerDetail.tsx`), styled to match the existing `InjuryStatus` countdown (same
  panel/badge treatment, slate-toned border instead of crimson) — a live countdown to when
  a resting adventurer becomes redeployable, so players can plan around it the same way
  they already could for injury recovery.
- Vacation Mode (from original TODO.md, Game Mechanics) — pause wage/maintenance collection
  without penalty; retention feature for a live player base.
- [x] Player ranking (2026-07-06) — split off from the original combined "Ranking and
  Achievements" item at the user's request; Achievements remains its own separate pending
  item below, deferred with no timeline yet. New **Leaderboard** nav tab (🏆, before Wiki),
  backed by `GET /api/v1/leaderboard` and a new `services/leaderboard.ts`. Score formula
  (as specified by the user): `(10 * (Reputation + Avg. Adventurer Power) + Assets) *
  Contract Success %`, where Assets = treasury gold + summed property `costBasis` (total
  invested capital, not liquidation value), Avg. Adventurer Power is averaged over the
  player's current non-dead roster (0 with an empty roster), and Contract Success % is
  `completed / (completed + failed)` adventures (0 with no history — a new player scores 0
  until they've actually succeeded at something). Computed via three grouped Prisma
  aggregates (adventurer power, property cost basis, adventure outcome counts) plus a
  players query, so it's O(1) queries regardless of player count rather than N+1 per player.
  Players who haven't finished onboarding (`guildName` still null) are excluded — nothing
  to rank yet. Response shape: top 10 always, plus the viewer's own rank, plus (only when
  ranked below 10th) a +/-5 window around their position so they can see who's just above
  and below them without scrolling a full leaderboard. This is the first feature exposing
  any cross-player data — deliberately kept to just rank/guild name/username/score, no
  breakdown of another player's underlying gold/reputation/power numbers. Test-covered in
  `test/leaderboard.test.ts` (score math, onboarding-incomplete exclusion, top-10-only vs.
  windowed response) and verified end-to-end in a real browser.
- [x] Fixed negative-reputation lockout (2026-07-06) — a player whose reputation dropped
  below 0 (from repeated contract-failure penalties) became unable to hire *any* adventurer,
  including the cheapest level 1–2 ones, and the Contract Board hid the Accept button for
  every contract including errand/standard — effectively a dead end with no way to recover
  gold or reputation. Root cause, found in four places: reputation thresholds of `0`
  (`HIRE_REPUTATION_REQUIREMENTS`'s level 1–2 entries, `CONTRACT_TIER_REPUTATION_
  REQUIREMENTS`'s errand/standard entries) are meant to mean "no gate at all," but every
  check compared the threshold against actual reputation with a plain `>=`/`<`, which
  incorrectly trips once reputation goes negative even against a `0` threshold. Fixed in
  `routes/adventurers.ts`'s hire route (backend, a real block), and three frontend-only
  spots that were stricter than the backend for no reason: `AdventurerMarket.tsx`'s hire
  button, `ContractMarket.tsx`'s `hasRep` (Accept/Bid button gating), and `ContractCard.tsx`'s
  `repBlocked` (the red "requirement not met" indicator). All four now treat `repRequired ===
  0` as unconditionally passable. **Design decision** (user chose): reputation is allowed to
  go negative permanently rather than flooring it at 0 — negative reputation remains a real,
  meaningful state (this fix just guarantees it can never fully lock a player out), which
  leaves room for the idea below rather than closing it off.
- [x] Fixed fire-then-rehire injury exploit (2026-07-06) — firing an injured adventurer
  unconditionally reset their status to `available`, clearing the injury entirely; the same
  or a different player could then immediately rehire them fully healed, bypassing the
  recovery timer for free. (Notably, injured adventurers already cost no daily wage —
  `services/economy.ts`'s `collectDailyWages` only charges `hired`/`on_adventure` — so there
  was no legitimate "cut my losses" reason to fire one early; the only reason to do it at all
  was this exploit.) Fixed in `routes/adventurers.ts`'s fire route: releasing an adventurer
  who is currently `injured` now keeps their status as `injured` (and leaves `poolExpiresAt`
  null) instead of resetting to `available` — they simply have no employer in the meantime.
  This meant `workers/marketGC.ts`'s recovery sweep (which previously assumed a recovered
  injured adventurer was always still employed, unconditionally setting `status: 'hired'`)
  needed splitting into two branches: still-employed recovers to `hired` as before;
  unemployed (fired while injured) recovers to `available` with a fresh `poolExpiresAt`,
  re-entering the open market only once actually healed. Firing an injured adventurer to
  free a roster slot remains possible (a legitimate roster-cap-management tradeoff) — the
  fix is specifically that doing so can no longer shortcut their recovery. Test-covered in
  `test/marketGC.test.ts` (split the existing recovery test into employed/unemployed cases,
  since the prior single test only exercised the unemployed path while asserting the
  employed-path outcome — a latent gap the fix exposed) and verified end-to-end in a real
  browser.
- Infamous/antagonistic guild content (2026-07-06, user's idea, captured for later — no
  scoping done) — since reputation can go negative and stay there, that opens design space
  for content aimed at "infamous" guilds unburdened by a sense of honor: unsavory or
  antagonistic contracts (smuggling, sabotage, extortion) available only *below* a
  reputation threshold, mirroring how `dangerous`/`legendary` contracts currently require
  reputation *above* a threshold. Would need its own reward/risk balance and probably its
  own contract-tier-like concept rather than reusing the existing four tiers.
- Achievements (from original TODO.md, Gamification, split off from the ranking item above
  on 2026-07-06) — no design work done yet; needs its own scoping pass before
  implementation.
- Adventurer equipment system (from original TODO.md, Game Mechanics).
- Contract class/stat requirements — a `requiredStats` field already exists as a stub in
  `packages/types/src/contracts.ts` marked "reserved for Phase 5."
- Dorm-space-based adventurer limits; party size limits (from original TODO.md, Game
  Mechanics).
- Deeper personality-stat effects (2026-07-05, concepts captured — needs game-design
  refinement before implementation, not ready to build as-is) — granular mechanics for all
  four personality traits (`loyalty`, `ambition`, `temperament`, `disposition`). Currently
  only `loyalty` has any gameplay effect at all (unpaid-wage quit risk in
  `services/economy.ts`); `ambition`, `temperament`, and `disposition` are rolled and
  displayed but otherwise inert. Proposed direction for each, pending balance/formula
  refinement:
  - **Loyalty** — already factors into quit risk when wages go unpaid. Proposed extension:
    combine with Ambition so **high Ambition + low Loyalty** creates an ongoing risk of the
    adventurer voluntarily leaving for a better opportunity on the open market, independent
    of whether they're actually being paid — a wealthy player could still lose an ambitious,
    disloyal adventurer.
  - **Ambition** — proposed to (1) accelerate XP gain, scaled by ambition; (2) interact with
    Loyalty as above; (3) accrue a loyalty penalty against the current employer if a
    high-ambition adventurer sits undeployed for extended periods, or is repeatedly sent on
    contracts below their capability — under-using an ambitious adventurer should itself
    raise defection risk over time, not just non-payment.
  - **Disposition** — proposed to drive a new **party cohesion/affinity** mechanic:
    adventurers frequently partied together build affinity over time, and high-affinity
    parties perform better (exact bonus — success chance? party power? — needs design).
    Disposition would govern how quickly that affinity builds (amiable adventurers bond
    faster than gruff ones). This is the largest of the four — it requires tracking
    historical party composition over time, which doesn't exist in any form today.
  - **Temperament** — wasn't even in the original TODO.md's personality-effects list,
    despite already existing as a rolled stat. Proposed to drive risk-taking behavior during
    contract execution: higher temperament trades safety for upside, e.g. higher potential
    reward at higher failure risk, or higher success chance at higher injury risk (the
    user's own examples — the exact trade-off curve is explicitly open, needs refinement).

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
- Invite-code system — a shareable, player-driven growth mechanic for controlled expansion
  beyond the trusted pool (distinct from the trusted-pool-stage Clerk "Restricted" sign-up
  mode in Pre-Beta, which only supports a fixed, admin-curated list). Makes more sense
  once there's an actual reason for existing players to invite others, which lines up with
  Beta Phase 4 (Social Features) shipping around the same time as this gate.
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
- [x] Frontend bundle code-splitting (2026-07-06) — a production build started warning that
  chunks exceeded 500KB after minification. Root cause: `App.tsx` statically imported every
  page component, and the default Vite config had no `manualChunks`/`chunkSizeWarningLimit`
  override, so the whole app (including heavy dependencies like `react-markdown`'s
  unified/mdast/micromark tree, used only by the Wiki page) bundled into one ~950KB script
  loaded on every visit regardless of which page was actually needed. Fixed in two layers:
  (1) route-level splitting — every page in `App.tsx` now goes through `React.lazy()`,
  wrapped in a single `<Suspense>` boundary with a shared `PageFallback`, so each page
  (including the Wiki's markdown-parsing weight) becomes its own chunk fetched on
  navigation; (2) vendor splitting — `vite.config.ts` gained `build.rollupOptions.output.
  manualChunks` to split `@clerk/react`, `@sentry/react`, and the core React/react-router
  trio into their own chunks, since those are needed immediately by every route and
  route-splitting alone can't shrink them (confirmed: after step 1 alone, the main chunk
  was still 613KB of eager vendor code). Verified via actual build output — chunks are all
  under the 500KB warning threshold, split across per-page chunks plus `clerk`/`sentry`/
  `react-vendor` bundles that will also cache better across deploys than a single
  monolithic bundle would, since vendor code changes far less often than app code.
- Configurable gameplay settings (2026-07-06) — tabled deliberately until there's enough
  player data to tune against; not worth building blind. Goal: balance numbers become
  runtime-editable (presumably via the existing Admin panel, `routes/admin.ts` /
  `pages/Admin.tsx`) instead of requiring a code change + full build/typecheck/test/deploy
  cycle for every tuning pass. Needs (1) an audit identifying every hard-coded gameplay
  constant, (2) a config storage scheme with defaults baked in or seeded, so a clean
  deployment never requires manually populating every value by hand before the game is
  playable — mirrors the same "safe to re-run" seeding principle already used for
  `prisma/seedWiki.ts`. Known constants to migrate, found incidentally while building other
  features this phase (not necessarily exhaustive — a real audit is part of this task):
  - `packages/types/src/game.ts`: `XP_PER_GOLD`, `XP_TO_LEVEL`/`MAX_LEVEL`,
    `HIRE_REPUTATION_REQUIREMENTS`, `CONTRACT_TIER_REPUTATION_REQUIREMENTS`,
    `QUIT_REPUTATION_PENALTY_PER_LEVEL`, `BASE_ROSTER_CAP`/`ROSTER_CAP_PER_DORM_LEVEL`.
  - `packages/api/src/services/adventure.ts`: all the injury/death/rest tunables added this
    phase (`FAILURE_INJURY_CHANCE`, `SUCCESS_INJURY_CHANCE`, the min-chance floors,
    `INFIRMARY_INJURY_REDUCTION_PER_LEVEL`, `DEATH_SHARE_OF_INJURY`,
    `REST_HOURS_FRACTION_OF_DURATION`), plus the success-chance curve
    (`Math.min(0.9, 0.3 + ratio * 0.5)`).
  - `packages/api/src/routes/properties.ts`: `PROPERTY_CONFIG` (build cost, maintenance,
    bonus per property type) and `UPGRADE_COSTS`.
  - `packages/api/src/workers/dailyReset.ts`: `DAILY_ADVENTURER_MIN`,
    `DAILY_ADVENTURERS_PER_PLAYER`.
  - `packages/api/src/services/bootstrap.ts`: `WELFARE_COOLDOWN_HOURS` and the welfare
    contract's own reward/duration values.
  - Adventurer generation formulas in `packages/types/src/generator.ts` (hire cost, daily
    wage, stat rolls) and contract generation in `packages/types/src/contracts.ts`.

## Post-Beta — Monetization
**Goal:** sustainable revenue, attempted only once retention is proven post-general-release.

- Ads, subscriptions, cosmetic purchases, season passes (from original TODO.md,
  Monetization). The original list itself frames these as open questions ("Ads? Subscription
  – what's the benefit?") — expect this phase to start with research/decisions, not
  implementation.
