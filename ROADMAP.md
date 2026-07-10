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
- [x] In-app wiki CRUD for admins (2026-07-07) — the original wiki entry above deliberately
  deferred an in-app editor until Admin/Moderator roles existed; `isAdmin`/`requireAdmin`
  already exist (built for the testing-tools `/admin` page), so this closes that gap without
  waiting for the full Gate-phase Admin/Moderator feature. No schema change — `WikiPage`
  already had everything needed. New `POST /api/v1/wiki`, `PATCH /api/v1/wiki/:id`,
  `DELETE /api/v1/wiki/:id` routes, all gated by `requireAdmin` (the existing `GET` routes
  stay open to any authenticated player); slug uniqueness checked manually before
  create/update (matching the existing username-uniqueness pattern in `player.ts`'s
  onboarding route) rather than catching a Prisma unique-constraint error. `DELETE` returns
  a JSON body (`{ success: true }`) rather than a bare 204 — the frontend's shared `request()`
  helper always calls `res.json()` on success, and this is the first `DELETE` route in the
  API, so there was no existing precedent either way.
  - Editing happens in-place on `/wiki` itself rather than as a new section on the `/admin`
    page — that page is explicitly scoped to "testing tools, not for regular gameplay use,"
    and keeping content wiki content management there would mean editing a page from a
    different screen than the one showing it. Admins viewing any page now see Edit/Delete
    buttons next to the title, and a "+ New Page" button in the nav sidebar; both open the
    same `WikiEditor` form (title/slug/nav order/Markdown body) with a live preview rendered
    through the same `react-markdown`/`remark-gfm` pipeline as the real page, so what an
    admin sees while editing matches what every player sees after saving.
  - No route-level test coverage — this codebase has no HTTP/route integration tests
    anywhere yet (a known, already-documented gap; see Post-Beta Infrastructure Maturity),
    so this follows existing precedent rather than introducing a new test paradigm for one
    feature in isolation.
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
- Mobile-friendly layout (2026-07-08, user's idea, captured for later — no scoping done):
  the app has never had a responsive-design pass. Checked the current state before writing
  this: the viewport meta tag is already present in `index.html` (so it's not starting from
  zero), but there are **zero `@media` queries anywhere in the codebase**, and several
  layouts are built on fixed assumptions that would break on a narrow screen —
  `Navigation.css`'s sidebar is a hard `width: 220px` with no collapse/hamburger behavior,
  and multiple pages use fixed-column grids (`AdventureDetail.css`'s `.detail-grid`/
  `.detail-stats` at `1fr 1fr`, `Dashboard.css`'s stat grid at `repeat(4, 1fr)`, `Wiki.tsx`'s
  nav+content two-column layout) that would squeeze rather than reflow. A few grids already
  use `repeat(auto-fill/auto-fit, minmax(...))` (`AdventurerMarket.css`, `Profile.css`),
  which is inherently more mobile-friendly and could be a pattern to extend elsewhere rather
  than starting from scratch everywhere.
  - Open questions to resolve when this gets scoped for real: responsive breakpoints
    (reflow existing layouts at narrow widths) vs. a dedicated mobile-specific UI (more work,
    but can make deliberately different UX choices — e.g. bottom nav instead of a collapsed
    sidebar); whether this is a full pass across every page or starts with the highest-traffic
    ones (Dashboard, Contract Market, Adventurer Market); and whether native-app-adjacent
    concerns (PWA installability, touch-target sizing, viewport-height quirks on mobile
    Safari) are in scope or a separate follow-up.

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
- Adventurer leaderboard (2026-07-09, user's idea, captured for later — no scoping done) —
  a separate leaderboard from the player ranking above, listing the most powerful individual
  adventurers game-wide: vocation, power level, number of adventures, success %, and
  employer. Ranked by power level, then success % as tiebreaker, then number of adventures as
  second tiebreaker. Likely lives alongside the existing player leaderboard
  (`pages/Leaderboard.tsx`, `services/leaderboard.ts`) as a second view rather than a new nav
  destination, given the precedent it sets. Open questions for the scoping pass: whether
  unemployed/market adventurers are included (their "employer" column implies at least an
  explicit "none" state) or this is scoped to currently-hired ones only; and whether it's
  restricted to top-N like the player leaderboard or fully browsable.
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
- [x] Fixed dead-adventurer resurrection + roster-cap undercounting (2026-07-06) — same root
  cause as the injury exploit above, discovered by the user immediately after that fix
  shipped: the fire route's status-reset logic didn't account for `dead` either, so releasing
  a dead adventurer reset them to `available` — fully alive again, reappearing in the market
  and rehireable by anyone. Separately, a dead adventurer sitting on a roster (not yet
  released) didn't count toward the roster cap in any of the three places that check it,
  even though it's still visibly occupying a roster slot until the employer releases it.
  Fixed both: `routes/adventurers.ts`'s fire route now keeps `status: 'dead'` (alongside the
  existing `injured`-preserving branch) when releasing a dead adventurer — release still
  works (clears them off the roster, pays any lingering severance), it just can't resurrect
  them. Roster-cap counting in the hire route, `Dashboard.tsx`, and `AdventurerMarket.tsx`
  dropped their `status !== 'dead'` exclusion — a dead adventurer now counts until released,
  same as an injured or resting one. `AdventurerMarket.tsx` needed splitting what had been
  one `hired` variable into two: `rosterCount` (all employed adventurers, dead included, for
  the cap) and `workingAdventurers` (excludes dead, for the desperate-hire eligibility hint —
  a player whose only adventurer just died should still qualify for the free bootstrap hire,
  regardless of whether they've cleaned up the corpse yet; this matches
  `services/bootstrap.ts`'s own `getBootstrapStatus`, which already excluded `dead` correctly
  and was left untouched). Also added a "deceased" count to the Dashboard's roster
  breakdown line, since the sub-counts (available/resting/deployed/injured) no longer summed
  to the roster total without it. Not unit-tested — same as the injury-exploit fix's route
  half, this logic lives directly in the fire route rather than an extracted service, and no
  HTTP route-level tests exist anywhere in this suite; there's no equivalent to the injury
  fix's `marketGC` recovery-sweep half here, since dead is terminal and never has anything to
  recover into. Verified end-to-end in a real browser.
- [x] Admin: Clear Adventurer Status tool (2026-07-06) — added at the user's request, to make
  manually testing injury/rest/death states (and the fixes above) faster without waiting out
  real timers or engineering a specific outcome via the RNG. New `GET /api/v1/admin/players/
  :id/adventurers` (a player's full roster, any status) and `POST /api/v1/admin/adventurers/
  :id/clear-status`, which forces an adventurer back to a clean working state — `hired` if
  still employed, `available` if not — clearing `injuryRecoveryUntil`, `restUntil`,
  `wagesOwed`, `daysUnpaid`, and `loyaltyPenalty` in one shot, bypassing recovery timers (and,
  for a dead adventurer, permanence itself) entirely. Deliberately unrestricted for
  `on_adventure` adventurers too, unlike the player-facing fire route — this is an
  admin-only override tool, not something subject to the same guardrails as normal play.
  New third panel on the **Admin** page: pick a player, see their full roster with status
  badges, "Clear Status" per row. Verified end-to-end in a real browser. **Follow-up**: the
  roster table initially showed resting adventurers as plain "hired" (indistinguishable from
  a genuinely clear one), since "resting" isn't a real status value — it's `status: 'hired'`
  plus a future `restUntil`. Fixed by computing the same `isResting` check `AdventurerCard.tsx`
  already uses and showing a distinct "resting" badge.
- [x] Admin: Seed Market tool (2026-07-06) — added at the user's request, after confirming
  `pnpm db:seed` (`prisma/seed.ts`) is destructive (wipes the available adventurer/contract
  pool before regenerating) and thus unsafe to run against a live database just to top up the
  market. The daily-reset worker already had purely-additive seeding logic
  (`workers/dailyReset.ts`'s old `seedAdventurers`/`seedContracts`, just `createMany`, no
  deletion) but it wasn't callable except from its own midnight-UTC cron. Extracted both into
  a new shared `services/marketSeeding.ts` (mirrors the same "extract for reuse" move as
  `services/adventure.ts`), which `workers/dailyReset.ts` now calls instead of duplicating the
  field-mapping logic. New `POST /api/v1/admin/contracts/seed` (adds one daily batch — 5
  errand, 8 standard, 5 dangerous, 2 legendary, same distribution as the real daily reset)
  and `POST /api/v1/admin/adventurers/seed` (adds a specified count, 1–100). New fourth panel
  on the **Admin** page. Verified end-to-end in a real browser.
- [x] Fixed "[object Object]" validation error messages (2026-07-06) — reported after trying
  to deploy more than 6 adventurers on a contract: the deploy failed silently except for a
  literal "[object Object]" in the dialog. Root cause was systemic, not isolated to this one
  route: 7 zod-validation-failure responses across 5 route files (`adventures.ts`, `admin.ts`
  ×3, `player.ts`, `auth.ts`, `properties.ts`) returned `{ error: parsed.error.flatten() }` —
  `flatten()` produces a structured `{ formErrors, fieldErrors }` object, not a string, breaking
  the `{ error: string }` contract every other error response in the API honors. The frontend's
  `ApiError` constructor calls `super(message)`, and per spec `Error()`'s constructor coerces
  a non-string argument via `ToString()` — for a plain object, that's exactly `"[object
  Object]"` — so the message was already mangled before it ever reached a render. Fixed at the
  root with a new shared `lib/zodError.ts` (`zodErrorMessage()`, joins `flatten()`'s message
  arrays into one string) used at all 7 call sites, plus added custom, player-friendly
  messages on the two validators players actually hit directly: the party-size limit
  (`adventurerIds` max 6, `routes/adventures.ts`) and the onboarding handle/guild-name
  validation (`routes/player.ts`). Verified end-to-end in a real browser.
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
- [x] Player events feed (2026-07-09) — replaced the Adventure Log tab with a unified,
  filterable/sortable **Feed** covering contract completions/failures, adventurer quits (with
  an approximated reason), injury recovery, and rest completion. Designed explicitly so a 6th+
  event type costs one enum value + one call site, per the user's stated requirement — closes
  out the "Player news feed" idea captured on 2026-07-07 (below is what actually shipped,
  replacing that entry).
  - New `PlayerEvent` model/`PlayerEventType` enum (`packages/api/prisma/schema.prisma`,
    mirrored in `packages/types/src/game.ts` per the enum-sync gotcha in `CLAUDE.md`) — same
    shape as the existing `Transaction`/`TransactionReason` ledger pattern. New
    `services/playerEvents.ts` gives every trigger point a single `logPlayerEvent()` call
    (DB write is real and can throw; the SSE publish is swallowed internally, matching every
    other `publish()` call in this codebase — CI has no Redis service at all, confirmed while
    building this, so an unswallowed publish would have broken every test that exercises a
    trigger point, not just this feature's own).
  - Five trigger points wired: `services/adventure.ts`'s `resolveAdventure()` (contract
    completed/failed, linking to the existing `/adventures/:id` detail page);
    `services/economy.ts`'s quit block (adventurer quit — reason approximated from data
    already on hand: "unpaid wages (N gp owed)" if `wagesOwed > 0` at the moment of leaving,
    else a generic "sought better opportunities elsewhere", deliberately not adding real
    cause-tracking to the loyalty-penalty accrual logic); `workers/marketGC.ts`'s injury
    recovery sweep (converted from a bare `updateMany` to a `findMany`-then-loop so each
    recovered adventurer's employer gets notified, mirroring the file's existing
    `deployMissed` pattern); and a brand new rest-completion sweep in the same file — rest
    previously had **no active trigger at all** (`restUntil` was only ever checked lazily
    wherever read), so this is genuinely new instrumentation, not a hook into existing code.
  - New `GET /api/v1/feed?limit=&offset=&type=` (`routes/feed.ts`, thin wrapper over
    `services/playerEvents.ts`'s `listPlayerEvents()`) at a fresh mount path — `/api/v1/events`
    was already taken by the SSE stream. Deleted `GET /adventures/history` outright (confirmed
    via grep it was used only by the page being replaced).
  - Frontend: new `pages/Feed.tsx` at the same `/adventures` route (so `/adventures/:id` links
    keep working untouched), with type filter tabs (mirroring `Transactions.tsx`'s filter
    pattern) resetting to page 0 on change, and pagination mirroring the old Adventure Log.
    Only `contract_completed`/`contract_failed` rows are clickable — an `adventurer_quit`
    event carries a `referenceId` for symmetry, but `routes/adventurers.ts`'s employer check
    (`adventurer.employerId !== req.playerId`) means the ex-employer can never actually view
    that adventurer's detail page again, so the frontend deliberately never links it. Dashboard
    gained a "Recent Events" panel next to the existing "Recent Ledger" one, same shape.
    `useSSE.ts` gained exactly one new handler, `player_event`, invalidating the `['feed']`
    query key prefix — every future event type this generic channel carries needs zero
    additional frontend wiring.
  - Scope cut mid-design: a global "market refreshed" event type (population-scaled market
    top-ups, daily adventurer reseeding) was planned and then deliberately dropped per explicit
    direction — this pass is scoped to events specifically about a player's own guild.
    `playerId` is a required field on `PlayerEvent`, not nullable; a global event type remains
    a small, well-understood follow-up if wanted later (nullable `playerId` + an
    `OR: [{ playerId }, { playerId: null }]` read, a pattern this codebase already uses
    elsewhere for `restUntil` in `services/adventure.ts`).
  - Test-covered at the service/worker layer (this codebase's established convention — no
    route-level/supertest tests exist anywhere, so `routes/feed.ts` stays a thin wrapper over
    a directly-tested service function rather than introducing a new testing pattern for just
    one route): new `test/playerEvents.test.ts` (`logPlayerEvent`, `listPlayerEvents`
    pagination/filtering/ownership), extended `test/marketGC.test.ts` (both new sweeps, event
    logged for the employed/hired case only), `test/economy.test.ts` (both quit-reason
    branches), and `test/adventure.test.ts` (both resolution outcomes). `pnpm typecheck`
    verified clean across all three packages; `pnpm test` requires the schema migration to be
    applied first (`pnpm db:migrate`, user's own action per this repo's convention) before it
    can pass — not yet run end-to-end at the time of this entry.
- [x] Adventurer equipment — a late-game gold sink (2026-07-09) — raised in a design
  discussion about what a fully-built guild has left to spend gold on: 7 properties cap at
  level 3 (~6,350 gold total, then a fixed 166 gold/day maintenance forever) and leveling is
  free (XP is a contract byproduct, not a spend), so a maxed 16-adventurer roster hits a wall
  with nothing left to do with surplus income. Weighed several directions in the same
  conversation — monetized cosmetics (blocked on an actual art/asset decision, see Beta Phase
  3 below), a Regions & World Map "office" buy-in (deliberately out of phase order, see
  Post-Beta below), reputation-buying/donations, mission risk-reduction spend, deeper
  property/roster tiers, an infamous-contract buy-in — and chose equipment first since it
  needs no new art pipeline and is structurally the best fit for a *recurring* sink rather
  than a one-time build.
  - **Single gear tier per adventurer** (not multi-slot, not a full itemized inventory) — one
    upgrade path 0-5, chosen deliberately as the simplest shape to build and balance for a
    first pass. New `Adventurer.gearTier` column (no new table).
  - **The mechanic that makes this a genuine late-game sink**: each tier requires a minimum
    adventurer level (`GEAR_TIER_LEVEL_REQUIREMENT`, tier 5 requires `MAX_LEVEL`), and cost
    scales with the adventurer's *current* power (`computeGearUpgradeCost`, same power-scaling
    posture as `computeHireCost`/`computeDailyWage`). Power rises with level, so the top tiers
    are both level-gated *and* the most expensive purchases in the game — the bulk of the
    spend lands exactly where a maxed-out roster already sits. Illustrative starting costs
    (not a final balance pass): tier 5 alone costs ~9,000 gold for a level-10 adventurer;
    fully gearing a 16-adventurer roster lands in the hundreds of thousands of gold, versus
    today's ~26k roster + ~6k property total.
  - **One-time purchase only for v1** — no repair/degradation/upkeep mechanic; can be layered
    on later if the sink still isn't deep enough once this has been live a while.
  - Bonus applies per-adventurer (unlike Training Hall/Cohesion, which apply uniformly to the
    whole party) to that adventurer's own power contribution before the party-wide bonuses in
    `computePartyPower` are layered on top (`services/adventure.ts`). Deliberately **not**
    written back into the stored `powerRating` — same "computed at use, not stored" pattern as
    Cohesion/Training Hall — so gear doesn't inflate hire cost, wages, or the Leaderboard's
    `avgPower` term (consistent with how Training Hall/Cohesion investment already don't move
    that score either, not a new inconsistency). Scoped to power only for v1, not contract
    stat/vocation requirement matching.
  - New `services/adventurerGear.ts` (`upgradeGear`) — a discriminated-result function rather
    than throwing, since the four failure modes here (not found, not your employ, already max
    tier, level too low, insufficient gold) map to four different HTTP statuses, not one
    uniform 409 the way `services/contracts.ts`'s `acceptContract` does. `routes/adventurers.ts`
    stays a thin wrapper (`POST /:id/gear/upgrade`) over it, keeping this codebase's
    business-logic-lives-in-services convention even though this file's older `/hire`/`/fire`
    endpoints predate that convention and remain untested/inline.
  - Frontend: new "Equipment" panel on `AdventurerDetail.tsx` (tier pips, bonus %, next
    tier's level requirement + cost, an upgrade button disabled with a clear reason when
    ineligible) mirroring `Properties.tsx`'s upgrade-button UX; a small "Gear T*n*" badge on
    `AdventurerCard.tsx` for at-a-glance roster visibility.
  - New `gear_upgrade` `TransactionReason` (Prisma enum + `packages/types` union, together,
    per the enum-sync gotcha documented in `CLAUDE.md`).
  - Test-covered: `packages/types/src/game.test.ts` (`computeGearBonus`,
    `computeGearUpgradeCost`, level-requirement ordering), new
    `packages/api/test/adventurerGear.test.ts` (successful purchase, all four rejection
    modes), and `packages/api/test/adventure.test.ts` (gear bonus changing a success/failure
    outcome, mirroring the existing Cohesion/Training Hall regression tests in the same
    file). `pnpm typecheck` verified clean across all three packages; `pnpm test` requires
    the schema migration to be applied first (`pnpm db:migrate`) before it can pass — not yet
    run end-to-end at the time of this entry.
- Adventurer traits/abilities (2026-07-07, user's idea, captured for later — no scoping
  done) — non-stat tags or abilities adventurers earn as they level up, giving each one a
  distinct bonus rather than just a bigger version of the same six stats. User's own
  example: **Lucky** — a flat bonus % to contract success chance. Natural fit once scoped:
  would plug directly into the `estimateSuccessChance()`/`countUnmetRequirements()`
  machinery already built for the contract-requirements feature (adds another additive/
  multiplicative term alongside the power ratio and requirement penalty), and "earned at
  level-up" ties into the existing `levelForXp`/level-up recompute already happening in
  `resolveAdventure`. Open questions for whenever this gets scoped for real: how many
  traits can one adventurer hold at once; are they rolled randomly at each level-up or
  chosen; do they only ever help (like the Lucky example) or can some be double-edged
  (echoing the Temperament risk/reward idea already captured in the personality-stat-effects
  item below); and whether trait pools should differ by vocation/heritage for flavor, or be
  universal.
- [x] Contract class/stat requirements (2026-07-06) — the `requiredStats` field (previously
  a stub, always `{}`) is now populated at generation time, alongside a new
  `requiredVocation` field (new nullable `Contract.requiredVocation` column). Two design
  options were on the table: hard-blocking party assignment vs. a soft success-chance
  penalty. Went with the soft penalty — found a strong consistency argument first:
  `requiredPower`, the existing analogous requirement, was never a hard gate either
  (`startAdventure` never checks party power at all; it only ever fed into the probabilistic
  success-chance formula), so making stat/vocation a hard gate would've been an inconsistent
  new mechanic sitting next to the one it's most analogous to. Also consistent with this
  session's running theme of eliminating "effectively locked out" scenarios (the reputation
  floor and dead-adventurer-resurrection fixes above).
  - **Generation** (`packages/types/src/contracts.ts`): scales by tier — errand never rolls
    a requirement; standard has a 40% chance of one stat requirement (threshold 12); dangerous
    always has one stat requirement (14) plus a 50% chance of also requiring a vocation;
    legendary always has a stat requirement (16) plus an 80% chance of a vocation. When both
    roll together, the stat is biased toward the required vocation's top-2 priority stats
    (`VOCATION_STAT_PRIORITY`) so the pairing reads coherently (e.g. "needs an Arcanist with
    strong Attunement") rather than two unrelated asks.
  - **Resolution** (`services/adventure.ts`): a requirement is met if *any single* party
    member satisfies it alone — the party doesn't need one adventurer covering everything.
    Each unmet requirement costs 5% success chance (`REQUIREMENT_PENALTY_PER_UNMET`), and the
    result is still clamped to the existing 30–90% range — requirements can make a mismatched
    party's odds worse, but never push them below the same floor every contract already has.
  - **Consolidation**: while wiring this in, noticed the success-chance formula
    (`Math.min(90, Math.round((0.3 + ratio * 0.5) * 100))`) was independently duplicated in
    four places (`resolveAdventure`, `Dashboard.tsx`, `ContractMarket.tsx`,
    `AdventureDetail.tsx`) — extracted a shared `estimateSuccessChance()` +
    `countUnmetRequirements()` into `packages/types`, used by all four, so the live
    success-chance preview a player sees before deploying always matches what actually
    happens, and any future formula tweak only needs to happen once.
  - **UI**: `ContractCard.tsx` already had display code for `requiredStats` ready and
    waiting (built when the field was still an unused stub) — just needed a
    `requiredVocation` badge added alongside it. Relabeled both from "Required" to
    "Preferred" to correctly communicate these are soft, not hard, gates. Deploy-modal
    previews (Dashboard, Contract Board) now show a "missing N preferred requirement(s)"
    note when applicable.
  - Test-covered in `packages/types/src/contracts.test.ts` (generation odds per tier,
    `countUnmetRequirements` edge cases, `estimateSuccessChance` clamping) and
    `test/adventure.test.ts` (an integration test proving an unmet requirement actually
    flips a specific outcome roll from success to failure). Verified end-to-end in a real
    browser.
- [x] Surfaced contract requirements at every point a player needs them (2026-07-09) —
  user-reported quality-of-life gap: requirements were visible on the Contract Market listing
  (`ContractCard.tsx`), but nowhere else in the flow that actually matters once a contract is
  accepted. The awaiting-deployment list on the Dashboard didn't show them at all, and the
  assign-party dialogs (Dashboard and Contract Market both have their own nearly-identical
  one) only showed the *aggregate* "missing N preferred requirements" count — telling a
  player something was unmet without saying what, forcing blind trial-and-error swaps of
  party members until the warning happened to clear.
  - New shared `adventurerMeetsAnyRequirement()` in `packages/types/src/contracts.ts`, a
    sibling to the existing `countUnmetRequirements()` — same per-condition logic, but
    answering "does this one adventurer meet any requirement" instead of "how many
    requirements does nobody in the party meet," since the party-assembly UI needed the
    former to highlight specific candidates, not just the aggregate.
  - Dashboard's "Contracts Awaiting Deployment" list now shows a compact "Needs: X, Y" line
    per contract. Both assign-party dialogs now show the same requirements list up front
    (not just after the fact via the missing-count warning), and each adventurer in the
    checklist gets a "Matches" badge if they individually satisfy at least one requirement —
    so a player can identify good candidates at a glance instead of guessing.
  - Local `formatRequirements()` helper duplicated between `Dashboard.tsx` and
    `ContractMarket.tsx` rather than extracted into a shared component — matches this
    codebase's existing convention for these two pages' near-identical assign-party dialogs,
    which were already independently maintained rather than sharing a component before this
    change.
  - Test-covered in `packages/types/src/contracts.test.ts` (vocation match, stat match,
    no-match, and the any-not-all case where one met requirement is enough despite others
    being unmet).
- [x] Fixed unbounded awarded-contract hoarding (2026-07-07) — flagged during a design
  conversation about bid-abuse potential: a player who accepted or won a contract could
  simply never deploy a party, and nothing ever reclaimed it — `expireOldContracts` only
  ever checked `status: 'available'`, never `'awarded'`. A high-reputation player could have
  bid on (or, worse, directly accepted — no reputation gate at all there) every
  dangerous/legendary contract in the market and sat on all of them indefinitely, denying
  them to everyone else at zero cost. New `Contract.deployBy` field, set the instant a
  contract is awarded (direct accept, bid win, or welfare claim) and cleared once a party
  actually deploys (`startAdventure`). Missing it fails the contract with the same
  `penaltyGold`/`penaltyReputation` it would've incurred from an actually-failed adventure —
  0 for welfare contracts, which are explicitly penalty-free, so this still clears them out
  of limbo without punishing a bootstrap safety net. New `contract_abandoned` transaction
  reason (added to both the Prisma enum and the `packages/types` TS union together, having
  learned that lesson the hard way earlier this session) for the ledger; a `$0` penalty
  doesn't get a ledger line at all, matching the existing convention of not logging no-op
  transactions.
  - **Two different deploy-by windows**, resolving a real fairness tension raised during
    design: direct-accept and welfare claims are player-initiated (the player is already at
    the keyboard when they act), so a short **3-hour** window is fair. Bid awards are decided
    by the market-GC sweep at a time entirely outside the winner's control — a short window
    risked expiring while a winner slept through no fault of their own — so bid-awarded
    contracts get a full **24-hour** window instead, guaranteeing at least one waking window
    regardless of timezone while still bounding the hoarding risk to "at most a day" rather
    than forever. Considered and rejected scrapping bidding entirely in favor of this
    differentiated-window approach, which keeps the competitive "highest reputation wins"
    mechanic intact.
  - New `workers/marketGC.ts` sweep (extending the existing 15-minute cycle rather than a
    new worker) finds `awarded` contracts past `deployBy`, fails them, applies the penalty,
    and pushes a new `contract_expired` SSE event (`useSSE.ts` invalidates `contracts/mine`,
    `player`, and `transactions` on receipt).
  - New `components/DeployByCountdown.tsx` (same live-countdown pattern as
    `DailyResetTimer`/`InjuryStatus`/`RestStatus`) shown per-contract in the Dashboard's
    "Contracts Awaiting Deployment" section, turning red under an hour remaining. Also fixed
    that section's copy, which said "You won these contracts through competitive bidding"
    even though it already listed direct-accept contracts too — a pre-existing inaccuracy
    predating this change, caught while in the area.
  - Test-covered in `test/marketGC.test.ts` (deploy-by set correctly on bid-award, penalty
    applied on miss, zero-penalty contracts skip the ledger line, not-yet-due contracts left
    alone) and `test/bootstrap.test.ts` (welfare claims get the short window). Verified
    end-to-end in a real browser.
- [x] Fixed never-bid dangerous/legendary contracts stranded on the market past their bid
  deadline (2026-07-07) — found from a user report: contracts showing "Bid closes Expired"
  (the frontend's client-side countdown, keyed on `bidDeadline`) were still sitting in the
  market and still acceptable, for up to 28 hours. Root cause: `runMarketGC`'s bid sweep only
  ever looked at `status: 'bidding'`, and a contract only transitions from `'available'` to
  `'bidding'` on its *first* bid — one that never received a single bid (e.g. because the
  player lacks the reputation to bid on it at all) never leaves `'available'`, so it fell
  through to the unrelated, much-later `expiresAt` cleanup (48h) instead of actually closing
  when its 20h bid window did. Fixed by widening the bid sweep's query to also match
  `'available'` contracts of the bidding tiers (`BIDDING_CONTRACT_TIERS`) once `bidDeadline`
  passes — a contract with zero bids at that point already falls into the existing
  no-bids-expire branch. Deliberately scoped by `tier` so errand/standard contracts (which
  also get a `bidDeadline` value even though it's meaningless for them) are untouched and
  continue to live until `expiresAt`, as intended. Test-covered in `test/marketGC.test.ts`
  (never-bid bidding-tier contract expires at its bid deadline without waiting for
  `expiresAt`; a never-accepted errand/standard contract is *not* early-expired at its
  otherwise-irrelevant bid deadline).
- [x] Redesigned bidding-tier market lifecycle to close a daily empty-market gap
  (2026-07-07, **supersedes the point-fix above**) — the previous fix stopped contracts from
  lingering past their deadline, but exposed the actual underlying problem: with a fixed 20h
  `bidDeadline` and a once-daily replenishment batch at 00:00 UTC, there was a guaranteed
  ~4-hour window every day with *zero* dangerous/legendary contracts on the market at all
  (20h < 24h refresh cycle). The user also flagged a fairness issue with any fixed
  from-creation deadline: a bid placed minutes before it closes leaves other players no real
  chance to counter-bid.
  - **Bidding tiers no longer have a deadline at creation.** `Contract.bidDeadline` is now
    nullable and stays `null` until a contract's *first* bid lands — an unbid contract simply
    never disappears from the market on its own, closing the gap entirely. The first bid
    starts a fixed **4-hour** counter-bid window (`BID_WINDOW_HOURS`), guaranteeing everyone
    gets the same full window to counter-bid regardless of when that first bid happened to
    land — resolving the fairness issue directly, since only the *first* bid sets the
    deadline; later bids on the same contract don't reset it.
  - **Standing target replaces the once-daily batch for dangerous/legendary.** `workers/
    marketGC.ts` now also runs `replenishBiddingMarket()` on its existing 15-minute cycle,
    topping up each bidding tier to a constant target (`BIDDING_MARKET_TARGET`: 5 dangerous,
    2 legendary — same numbers as the old daily batch, now a floor instead of an addition) by
    counting contracts still `available` or `bidding`. This is what actually prevents the
    gap — a bid-triggered timer alone doesn't help if nothing replaces a contract once it's
    won. `generateDailyContracts()`/`seedContracts()` (still run once daily) now only cover
    errand/standard, which keep their original fixed-batch-plus-`expiresAt` model unchanged,
    since direct-accept contracts don't have this gap problem (nothing gates them on an
    auction resolving).
  - **Backstop expiry for contracts nobody ever bids on.** Without *some* eventual expiry, an
    unpopular contract would occupy its standing-target slot forever, since replenishment
    only tops up a shortfall, it doesn't evict. Bidding-tier contracts get a deliberately
    generous `expiresAt` of **96 hours** (`BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS`, vs. 48h
    for direct-accept) — long enough not to recreate the original gap given replenishment is
    now reactive, but still guarantees eventual rotation. Reuses the *existing* generic
    `status:'available', expiresAt < now` sweep in `marketGC.ts` with no special-casing
    needed — it already runs for every tier, and now just sees a different `expiresAt` value
    depending on which tier generated the contract.
  - This is a straight simplification of the point-fix's `biddingExpired` query — the
    `tier`/`status:'available'` widening added there becomes unreachable under the new model
    (an `'available'` bidding-tier contract's `bidDeadline` is always `null` now, never a
    past timestamp), so the query reverts to its original, simpler `status:'bidding'` form.
  - Frontend: `ContractCard.tsx` shows "Open for bidding" instead of a countdown when
    `bidDeadline` is `null`. Admin's "Seed Contracts" button now also calls
    `replenishBiddingMarket()` alongside the errand/standard batch, since the old copy ("5
    errand, 8 standard, 5 dangerous, 2 legendary") was describing a batch that no longer
    exists for the bidding tiers.
  - Test-covered in `packages/types/src/contracts.test.ts` (generated contracts leave
    `bidDeadline` null and pick the correct tier-dependent `expiresAt`; the daily batch no
    longer includes bidding tiers) and `test/marketGC.test.ts` (never-bid contracts sit
    untouched indefinitely until their backstop expiresAt; standing-target top-up from an
    empty market, no over-adding once at target, bidding-status contracts count toward the
    target same as available ones). No route-level test for "first bid sets the 4h window" —
    this codebase has no HTTP integration tests anywhere yet (existing, documented gap), so
    that specific behavior needs a real browser check: place a bid, confirm the card switches
    from "Open for bidding" to a live "Bid closes" countdown.
- [x] "Accept for Later" for direct-accept contracts (2026-07-07) — the deploy-by system
  above assumed a player could accept an errand/standard contract without immediately
  assigning a party, but there was actually no way to do that: the only "Accept" button
  opened the party-selection modal immediately, chaining accept and deploy into one forced
  flow. New second button on `ContractCard.tsx`, "Accept for Later" (secondary style,
  next to the existing primary "Accept & Assign Party"), calling the accept endpoint
  directly with no modal — the contract just becomes `awarded` and shows up in the
  Dashboard's "Contracts Awaiting Deployment" section (with its deploy-by countdown) to
  deploy whenever convenient, same as a bid-won contract already did. Backend needed no
  changes — `POST /contracts/:id/accept` was already a standalone endpoint; the frontend
  had just never exposed calling it without immediately chaining to deploy. Verified
  end-to-end in a real browser.
- [x] Ambition/Loyalty trade-off mechanics (2026-07-07) — the first of the four personality
  traits' concepts (captured 2026-07-05 below) to actually get built. High Ambition is now a
  genuine trade-off, not just a rolled-and-displayed stat: faster leveling, but a growing,
  pay-independent risk of quitting if the adventurer feels under-utilized. This required
  restructuring the existing wage/quit-risk system in `services/economy.ts` rather than
  bolting on something parallel to it — `Adventurer.loyaltyPenalty` (previously fed only by
  unpaid wages) is now a shared pool fed by three independent sources, and the quit-check
  (previously only rolled for adventurers unpaid *that specific cycle*) now runs daily for
  *every* hired adventurer carrying any accumulated penalty, regardless of payment status —
  otherwise a well-paid but neglected ambitious adventurer could never actually leave, which
  was the whole point of the ask.
  - **XP bonus**: `computeAmbitionXpMultiplier()` — +5% per ambition point above 1, so
    ambition 1 (Content) gets none and ambition 5 (Obsessed) gets +20%, applied in
    `resolveAdventure` on top of the existing per-party-member XP split.
  - **Tier-mismatch penalty**: `minSatisfyingTier(level)`/`isTierBelowTolerance()` — levels
    1–2 tolerate anything, 3–4 want standard+, 5–6 want dangerous+ (matches the user's own
    two examples exactly: a level-3 adventurer minds an errand, a level-6 one is only
    satisfied by dangerous/legendary). Checked once per deployment in `startAdventure`.
  - **Idle-neglect penalty**: new `Adventurer.daysIdle` counter, incremented daily
    (`collectDailyWages`) for anyone `hired`-but-undeployed (excludes `on_adventure`,
    injured, and resting — none of those are neglect), reset to 0 on redeployment. A
    2-day grace period (`IDLE_LOYALTY_GRACE_DAYS`) before it can cost anything at all.
  - **Shared chance mechanism**: both new triggers use the same shape — an ambition-scaled
    *chance* per trigger event to lose 1 loyalty point (`AMBITION_LOYALTY_CHANCE_PER_POINT`
    = 8% per ambition point, so up to 40% at ambition 5), rather than a guaranteed hit, so a
    single unlucky assignment doesn't wreck a high-loyalty adventurer outright. Confirmed
    this pacing and the XP bonus size with the user before building rather than guessing.
  - **Correctness catch during implementation**: the first draft would have made the unified
    quit-check roll for *every* hired adventurer regardless of accumulated penalty, using
    their raw `personality.loyalty` value — caught via the existing `economy.test.ts` suite,
    where a test with no `Math.random` mock and a neutral-loyalty adventurer would have
    started intermittently failing (a healthy, undamaged adventurer would've had a real
    standing daily quit chance purely from a neutral personality score, which was never the
    intent). Fixed by gating the quit-roll on `loyaltyPenalty > 0` — it's strictly a
    consequence of mistreatment/neglect from an actual source, never ambient background risk.
  - Also required pinning `Math.random` in one existing test that had a nonzero
    `loyaltyPenalty` fixture value without expecting a quit roll to run against it — a real
    gap the restructuring exposed, not a pre-existing bug.
  - New "Loyalty" status panel on the adventurer profile page (`AdventurerDetail.tsx`,
    matching the existing Injury/Rest panel treatment) shown whenever `loyaltyPenalty > 0` —
    a static standing display rather than a countdown, since this is a daily-tick
    probabilistic risk, not a fixed timer.
  - Test-covered in `test/economy.test.ts` (grace period, idle-driven quit independent of
    payment, resting adventurers excluded from idle accrual) and `test/adventure.test.ts`
    (tier-mismatch penalty applied/not-applied, `daysIdle` reset on deployment, XP scaling).
    Verified end-to-end in a real browser.
- [x] Party cohesion / Disposition affinity (2026-07-07): pairs of adventurers who complete a
  contract together build affinity over time, and a party's average affinity grants a small,
  capped bonus to its total power — the last of the four personality traits (after Loyalty,
  Ambition, Temperament) to get a real mechanic.
  - New `AdventurerCohesion` join table: one row per **unordered pair** of adventurers, keyed
    by `(adventurerLowId, adventurerHighId)` with the pair's two IDs always sorted
    lexicographically before every read or write. Chose this over storing two rows per pair
    (A→B and B→A) to avoid dual-write inconsistency risk, and over computing cohesion on the
    fly from `AdventureAdventurer` history (counting shared past adventures at read-time)
    because the bonus needs to be read on every party-assembly interaction but only written
    once per contract resolution — precomputing at write-time is the right trade given the
    read:write ratio. No row exists until a pair has adventured together at least once; an
    empty query result *is* "0 cohesion," not a missing/error case.
  - Cohesion increases by `5 + dispositionA + dispositionB` (7–15 per shared contract,
    depending on both members' Disposition, 1–5 each) every time a pair completes a contract
    together, clamped at 100. Confirmed with the user: accrues **regardless of success or
    failure** — shared hardship on a loss still counts as time spent together, and (more
    importantly) gating it on success-only would have made an already-successful party's
    power compound further, the same rich-get-richer pattern the roster cap and other
    anti-snowball mechanics have deliberately avoided elsewhere in this codebase.
  - Party bonus is `50% * (average cohesion across every pair in the party) / 100`, so 0-50%
    of the party's total power (base power rating + Training Hall bonus). A party's average
    is computed over **every possible pair**, not just pairs with an existing row — a
    brand-new member with zero affinity to the rest of the party dilutes the average rather
    than being excluded from it. Tuned up from an initial 0-10% after the user tried it and
    wanted the effect to be *felt* — specifically, wanted losing a high-cohesion party member
    (injury, death, being fired) to noticeably hurt the remaining party's odds, not be a
    rounding error. `COHESION_MAX_POWER_BONUS` is the single constant controlling this scale.
  - Cohesion also **decays**: every cohesion pair loses a flat 1 point per day in the daily
    reset worker (`decayCohesion()` in `workers/dailyReset.ts`, alongside the existing
    adventurer/contract expiry sweeps), and any pair that decays to 0 or below has its row
    deleted outright rather than lingering at 0 — consistent with "no row = 0 cohesion"
    already being the table's contract. Negligible for a pair still adventuring together
    regularly (each shared contract adds 7-15 vs. -1/day), but erodes a maxed-out pair back
    to nothing after a few months of inactivity, so cohesion reflects an active working
    relationship rather than a permanent unlock. `COHESION_DAILY_DECAY` is the tunable.
  - New shared pure functions in `packages/types/src/game.ts`: `computeCohesionIncrement`,
    `computeCohesionBonus` — the latter used both server-side (`computePartyPower` in
    `services/adventure.ts`, feeding the real success-chance roll) and client-side (new
    `lib/cohesion.ts` helper in the frontend), so the bonus shown during party assembly on
    the Dashboard and Contract Market always matches what resolution actually uses.
  - **Existing gap found, left alone**: `computePartyPower` already silently adds a Training
    Hall property bonus that none of the three frontend party-power previews (Dashboard,
    Contract Market, Adventure Detail) reflect — a pre-existing divergence, not something
    this change introduced. Cohesion needed real frontend visibility (unlike the training
    hall bonus) since the user explicitly wanted it surfacing during party assembly, so
    `/player/me` now returns the roster's full pairwise cohesion set once per load and the
    frontend computes the bonus for whatever party is currently selected without a
    round-trip per checkbox toggle. `AdventureDetail.tsx` (a read-only view of an
    already-committed party, not an assembly step) was deliberately left out of scope,
    consistent with that existing gap.
  - Adventurer profile page (`AdventurerDetail.tsx`) gained a "Party Affinity" section
    listing every adventurer this one has ever adventured with and their current affinity
    percentage — sourced from `/adventurers/:id`'s new `affinities` field, which includes
    partners regardless of whether they're still employed (or even still alive), since the
    relationship itself is what's being shown, not current roster membership.
  - Test-covered in `packages/types/src/game.test.ts` (increment math, bonus averaging
    including the zero-fill-for-never-partnered-pairs behavior) and
    `packages/api/test/adventure.test.ts` (accrual on both success and failure, clamping at
    100, and a pre-existing max-cohesion pair flipping a contract's outcome via the power
    bonus). `decayCohesion()` itself has no direct test — `workers/dailyReset.ts` has no
    existing test file at all, and its sibling functions (`expireOldAdventurers`,
    `expireOldContracts`) are equally untested today, so this follows existing precedent
    rather than introducing a new testing pattern for one function in isolation.
- [x] Temperament risk/reward trade-off (2026-07-07): higher-temperament adventurers are
  individually rolled per party member in `resolveAdventure` for a reckless gamble — a
  chance, on a *successful* contract only, to bump that contract's gold reward, but also a
  flat additive bump to their own injury chance regardless of whether the contract succeeds
  or fails (recklessness carries risk either way, unlike the reward bonus which only pays out
  on a win). Both scale linearly with the adventurer's `personality.temperament` (1-5):
  - **Bonus-reward roll**: 5% chance per temperament point (5%-25%) to trigger, checked
    independently for *each* party member. Each trigger adds +10% of the contract's base
    gold reward, stacking additively across the party — a full 4-person party of temperament
    5 adventurers could in theory stack up to +40% (unlikely all four roll, but possible).
    Reflected in the ledger transaction's description (`+X gp reckless bonus`) and folded
    directly into the existing `goldDelta` used everywhere downstream (player balance, ledger
    amount, SSE `adventure_completed` push) — no new field needed since the total already
    includes it.
  - **Injury-chance bump**: +2% per temperament point (+2%-+10%), added on top of the
    existing success/failure base injury rate *after* the infirmary reduction and floor are
    applied — i.e., it isn't itself subject to the `MIN_SUCCESS_INJURY_CHANCE`/
    `MIN_FAILURE_INJURY_CHANCE` floors, since recklessness is additional risk layered on
    whatever the base already is, not a substitute floor.
  - Confirmed with the user: gold-only bonus (not XP or reputation), and the proposed
    5%/point — +10%/trigger — +2%/point magnitudes as a starting balance, adjustable later
    from real play data.
  - New constants in `packages/types/src/game.ts`: `TEMPERAMENT_BONUS_CHANCE_PER_POINT`,
    `TEMPERAMENT_BONUS_GOLD_PER_TRIGGER`, `TEMPERAMENT_INJURY_BONUS_PER_POINT`. No schema
    migration required — `personality.temperament` already existed as part of the `Json`
    blob, unused until now.
  - **Test-suite ripple effect**: inserting a new `Math.random()` call into
    `resolveAdventure`'s per-adventurer loop (the bonus-reward roll, consumed whenever the
    contract succeeds) shifted the sequence for several existing `adventure.test.ts` tests
    built on chained `.mockReturnValueOnce(...)` calls calibrated to the old, smaller call
    count. Audited every test in the file call-by-call rather than just running the suite and
    reacting to failures, since a queue running dry silently falls through to *real*
    `Math.random()` rather than throwing — that would have made affected tests intermittently
    flaky (occasionally failing an exact-gold-amount assertion) instead of reliably red.
    Fixed by adding the extra mocked value to each affected sequence (`resolves a successful
    adventure...`, `is idempotent...`, `can injure (but rarely kill)...`). Tests using
    `success: false` outcomes were unaffected, since the bonus roll is gated on
    `success && ...` and short-circuits. Added two new dedicated tests exercising the
    mechanic directly: a triggered reckless-bonus payout and a temperament-driven injury that
    wouldn't have occurred at the base rate.
- [x] Procedural contract naming/descriptions (2026-07-07) — replaced the fixed pool of ~30
  hand-written title/description pairs (`packages/types/src/contracts.ts`) with a word-bank
  composition system, to stop the same handful of contracts from resurfacing constantly once
  players had been through the pool a few times.
  - A shared world of 18 named locations (reusing every proper noun already established
    across the old fixed templates — Ironhaven, Duskfort, Ashveil, Greyspire, Coldmere,
    Ironspire, etc. — plus new additions, so the game's existing "geography" stays
    consistent) combines with tier-scoped "flavor" entries (the actual trouble/threat/quest
    hook, escalating from mundane at errand to apocalyptic at legendary), tier-scoped
    clients, and 2-3 sentence patterns per tier. Each flavor entry carries both a Title Case
    `label` (for the contract title) and a lowercase `hook` fragment (for prose), so
    interpolation never has to guess at capitalization or grammar — every generated
    combination reads as a properly-formed sentence, not word-salad.
  - This takes the previous ~7-10 fixed options per tier to on the order of 100-400+ unique
    title combinations per tier (fewer for legendary, deliberately — kept to 2 patterns
    instead of 3 so those still feel rarer and more singular than the other tiers).
  - Recent-title dedup mirrors the existing pattern in `generator.ts` for adventurer names
    (a rolling window of the last 20 titles, retried up to 5 times before accepting
    whatever comes up) — not a hard uniqueness guarantee, but enough to stop the same exact
    contract from resurfacing back-to-back given the much larger combinatorial pool.
  - Zero changes needed anywhere outside `contracts.ts` — `GeneratedContract.title`/
    `.description` kept the exact same shape, so the API routes, Prisma writes, and every
    frontend consumer are unaffected. `prisma/seed.ts`'s own separate, hand-curated
    `CONTRACT_TEMPLATES` (used only for one-time fresh-database bootstrapping, not the
    ongoing market generation this change touches) was deliberately left alone.
  - Test-covered in `packages/types/src/contracts.test.ts`: non-empty title/description for
    every tier, and a 60-sample generation producing well over the old fixed-pool size in
    unique titles. **Correction (2026-07-08)**: this originally also asserted zero
    back-to-back repeats across 20 consecutive generations per tier — removed after it failed
    intermittently in CI. The recent-title dedup is an explicit best-effort mechanism (fixed
    retry count, then accepts whatever it gets, same as generator.ts's adventurer-name
    history), not a hard guarantee, and legendary's pool is thin enough (one of its two
    patterns ignores location entirely, leaving only 6 "hot" values) that a genuine collision
    surfaces often enough to make that specific assertion flaky rather than a real regression
    signal. The variety test above remains the meaningful coverage.
- [x] Fixed grammar/repetition bugs in procedural contract generation (2026-07-10) — user
  report: descriptions were "sometimes nonsensical" and titles felt repetitive despite the
  word-bank system above. Root-caused two distinct bugs by sampling real generated output
  rather than reasoning about the templates abstractly:
  - **Pronoun/verb-agreement bug**: several flavor `hook`s describe a person or people ("a
    debtor who has gone conveniently quiet", "bandits ambushing traders"), but every pattern
    that refers back to the hook used a generic "it" and verbs like "put to rest"/"handled"
    that only make sense for an impersonal situation. Produced real broken output like *"The
    village elder has the only healer for three villages, gone missing and needs **it**
    handled"* (a missing person called "it"), and — worse — *"...a party that can put
    **it** to rest"* applied to **Escort Risk**'s hook (a lorekeeper who needs protecting),
    which reads as a kill order for a protection job, backwards from the contract's actual
    intent. Fixed by tagging every `FlavorEntry` with a `subject: 'thing' | 'hostile' |
    'friendly'` (thing = impersonal situation/creature/organization, "it"/"put to rest" fit
    fine; hostile = a person or people to confront, needs "them" and a confrontational verb;
    friendly = someone the party is meant to help, needs "them" and a protective verb — "put
    to rest" specifically reads as violent when pointed at someone to rescue, not fight) and
    routing every pronoun/verb reference through two new small helpers
    (`resolutionObject`/`confrontPhrase`) instead of hardcoding the phrase in each pattern.
    Tagged all 34 flavor entries across all four tiers by hand.
  - **Repetition — two separate causes, both fixed**: (1) the recent-title dedup
    (`titleHistory`) was one 20-slot window **shared across all four tiers**, so
    errand/standard's high generation volume (targets of 5 and 8) evicted dangerous/
    legendary's own recent entries almost immediately — the tiers that most needed dedup
    protection (lowest volume, thinnest pools) were getting the least of it. Switched to a
    `Record<ContractTier, {...}>` — one independent 20-slot window per tier. (2) legendary's
    second title pattern ignored location/client entirely (`` `Legendary Contract: ${f.label}` ``),
    so every title from that pattern was identical for a given flavor regardless of which of
    the 18 locations got picked — already flagged as a known weak spot in this file's
    2026-07-07 entry above, now actually fixed (both legendary patterns include location).
    Also widened legendary's own pools while in there, since it was already the thinnest of
    the four and the one most exposed by bug (1): 6→10 flavors, 5→7 clients (pattern count
    deliberately left at 2 — that was an intentional choice for legendary to feel rarer, not
    an oversight).
  - Also fixed a smaller, related grammar bug spotted while sampling output for the above:
    `STANDARD_CLIENTS` included `'two feuding families'`, a plural client colliding with
    patterns hardcoding singular verbs (`wants`, `is offering`) — produced *"Two feuding
    families **wants** it handled..."*. Reworded to `'a pair of feuding families'` (a
    singular collective noun) rather than adding a second grammatical-agreement tagging
    system for what was really one bad string. **Not otherwise audited**: a few legendary
    clients (`'a neutral coalition'`, `'a desperate garrison'`) are singular collective nouns
    paired with the plural-agreeing verb "say" (`"A neutral coalition say..."`) — left as-is,
    since collective-noun-plus-plural-verb is a long-established, accepted English
    convention (especially in narrative prose), unlike the "families wants" case, which was
    unambiguously wrong in any variety of English.
  - Test-covered in `packages/types/src/contracts.test.ts`: unit tests for
    `resolutionObject`/`confrontPhrase` (now exported) covering all three subject types; a
    black-box regression guard that generates 300 contracts per tier and checks that whenever
    a known hostile or friendly hook's exact text appears in the description, the broken
    "needs it"/"put it to rest"/wrong-direction verb never does; and a legendary-specific
    test confirming every generated title now contains a real location (`CONTRACT_LOCATIONS`,
    now exported), the direct regression guard for the location-less-pattern bug. `pnpm
    typecheck` and `pnpm test` both verified clean, and real sample output was generated and
    read manually to confirm the fix beyond just the automated assertions.
- Contract narratives in the completion report (2026-07-07, captured — not yet built):
  procedurally generate a short narrative paragraph for the "Party Report" section shown
  once an adventure resolves (`AdventureDetail.tsx`, currently a plain per-adventurer table —
  see `xpGained`/`injured`/`died` columns), rather than just the bare data table it is today.
  The narrative should incorporate the actual adventurer names on the party, their vocations
  and stats (so a Sellsword's beat reads differently from an Arcanist's), and any side
  effects that occurred (injury, death) — the goal being that two completions of the same
  contract with different parties or different outcomes read as genuinely different stories,
  not a templated Mad Lib. Open questions to resolve when this gets scoped for real:
  - Composition approach: likely the same word-bank-plus-pattern technique as the contract
    naming work above, but keyed off *outcome data* (`AdventureAdventurer` rows) rather than
    tier — needs per-vocation flavor text (a Sellsword's contribution described differently
    from a Mender's) and outcome-branching (a clean success reads differently from a
    success-with-injuries, which reads differently from a failure with a death).
  - How much stat data actually surfaces in the prose vs. just informing which flavor text
    gets picked (e.g. "his Might carried the line" only makes sense if Might was actually
    the adventurer's standout stat) — needs a rule for picking which stat/vocation detail is
    worth mentioning per adventurer, not surfacing all six stats verbatim.
  - Party-size handling: a solo adventurer's narrative reads very differently from a
    six-person party's — probably needs distinct structure rather than just repeating a
    per-adventurer sentence six times.
  - Where it's stored: computed fresh each time the report is viewed (cheap, always
    consistent with current data) vs. generated once at resolution and persisted (stable
    even if generation logic changes later, but needs a new column/table). Leans toward
    persisting at resolution, matching how `AdventureAdventurer` already snapshots
    per-adventurer outcomes at resolution time rather than deriving them live.
- Chained contracts (2026-07-10, user's idea, captured for later — no scoping done) — a
  series of contracts of escalating difficulty forming a single-player narrative arc, visible
  only to the player currently working through the chain (not claimable by anyone else, unlike
  every contract today, which is either sitting in the shared market or already awarded to
  someone). Completing the full chain grants a reward independent of the individual contracts'
  own `rewardGold`/`reputationReward` payouts. Distinct from the "Contract narratives" item
  above — that's flavor text on a single already-existing contract's outcome; this is a whole
  contract *structure* spanning several contracts in sequence, with its own visibility model.
  Open questions for whenever this gets scoped for real:
  - **Visibility/ownership is the biggest architectural gap**: every contract today is either
    public (`status: 'available'`/`'bidding'` in the shared market) or already claimed
    (`awardedTo` set once accepted/won). Nothing currently models "generated for, and visible
    only to, one specific player from the moment it's created" — would need a new field
    (something like an owning `playerId` set at generation time, distinct from `awardedTo`,
    which today only ever gets set at claim time) and a market-query change so chain contracts
    never show up in `GET /contracts/market` for anyone but their owner.
  - What actually escalates between links in the chain — `requiredPower`/reward scaling similar
    to jumping tiers within `CONTRACT_TIER_CONFIG`, or its own independent difficulty curve not
    tied to the existing four tiers at all?
  - What triggers a chain to start (opt-in vs. automatically offered at some milestone), and
    whether a player can have more than one chain active/available at once.
  - What the completion reward actually is — a large one-off gold/reputation bonus, or
    something with no other source in the game (a title/cosmetic, once Beta Phase 3's
    customization work exists; ties naturally to the also-unscoped Achievements item below).
  - Whether the chain narrative uses fixed, hand-written contracts (simpler, but a finite
    number of chains before repetition) or leans on the procedural flavor system
    (`packages/types/src/contracts.ts`) extended with chain-aware continuity (each link's
    flavor referencing the same location/client/threat as the one before it, rather than
    independently random every time).
- Party vocation/role synergies (2026-07-10, user's idea, fleshed out in design discussion —
  no scoping done). **Not to be confused with "Chained contracts" directly above** — that's a
  sequence of *separate* contracts forming a narrative arc across multiple accept/complete
  cycles; this is about a *single* contract's resolution becoming a sequence of encounters
  internally. Promotes the "contracts favoring certain party compositions by role" note
  flagged as a planned future feature during the property overhaul work (2026-07-08, see
  above) into an actual design.
  - **Two-fold intent, from the user directly**: (1) encourage players to hire more
    deliberately for a *balanced roster*, not just the highest-power adventurers available —
    today, power rating is the only thing that matters for `estimateSuccessChance`
    (`packages/types/src/contracts.ts`), so an all-Sellsword roster is strictly optimal if
    their power is high enough; (2) add depth to party assignment on top of the existing
    Cohesion (`computeCohesionBonus`) and stat/vocation requirement (`countUnmetRequirements`)
    mechanics, which are the only two things currently rewarding *which specific adventurers*
    get deployed together beyond raw summed power.
  - **The synergy design space** — specific vocations/roles doing specific things well, per
    the user's own examples: a **Mender** in the party reduces injury/death chance (today
    injury/death is a flat roll off `FAILURE_INJURY_CHANCE`/`SUCCESS_INJURY_CHANCE`/
    `DEATH_SHARE_OF_INJURY` in `services/adventure.ts`, with no adventurer-composition input
    at all); **Fighter**-role vocations (Sellsword, Outrider — see `VOCATION_PARTY_ROLE`) help
    disproportionately on combat-heavy contracts; **Rogue**-role vocations (Trickster,
    Alchemist) help on contracts about subterfuge/skullduggery. Wizard's (Arcanist, Invoker)
    specific angle wasn't specified — open question. This reuses the `PartyRole` taxonomy that
    already exists for property bonuses, just applied to contract *outcomes* instead of
    passive XP/loyalty gains.
  - **May replace the current stat/vocation requirement system**, per the user — today's
    `requiredStats`/`requiredVocation` (a contract wants e.g. Might 15, or a Sellsword
    specifically, checked by `countUnmetRequirements`/`adventurerMeetsAnyRequirement`) is a
    flat pass/fail gate. The user's framing is that role-synergy effects would be "a more
    natural and narrative implementation" of the same underlying idea (the party's makeup
    should matter to a contract's outcome) — worth a real design decision on replace-vs-
    coexist once this gets scoped, not assumed either way here.
  - **The bigger proposed mechanism — chained encounters instead of one roll**: rather than a
    single `estimateSuccessChance(partyPower, requiredPower, unmetRequirements)` check
    (current model, one `Math.random()` roll decides the whole contract), a contract's
    resolution becomes a short *series* of separate encounters chained together — closer to
    how a tabletop RPG session actually runs a job (several distinct beats, not one skill
    check). Each encounter's own outcome is influenced by overall party power *and* by
    whether specific vocations/roles/stats relevant to that particular encounter are present
    in the party — a combat encounter cares about Fighter presence, a subterfuge encounter
    cares about Rogue presence, and so on. The contract's overall success (and the detail fed
    into its report) comes from how the party fared across the whole chain, not one number.
    - **Natural fit with "Contract narratives" above**: that item's own open questions
      struggled with how to make two completions of the same contract read as genuinely
      different stories rather than a templated Mad Lib. A per-encounter outcome sequence is
      exactly the structured data a narrative generator needs — "the party was ambushed at
      the ford (failed encounter 2, injury), but recovered to clear the pass (encounter 3
      success)" is a real beat-by-beat story, not achievable from today's single win/lose
      flag.
    - **Resolution stays a black box to the player**, explicitly, per the user — no new UI
      showing encounters play out live. The player's role is unchanged: get the contract,
      assemble a party, wait for the result. The richer simulation is entirely server-side;
      it only surfaces after the fact, through the (also unbuilt) narrative report.
    - **Promising, not-yet-confirmed implementation angle**: the procedural flavor system
      overhauled 2026-07-10 (see the "Fixed grammar/repetition bugs" entry above) already
      tags each contract's flavor hook with a `subject` (`'thing' | 'hostile' | 'friendly'`)
      and draws from thematically distinct flavor pools (combat-flavored hooks like Wyvern/
      Bandit Ambush vs. subterfuge-flavored ones like Smuggling Ring/Crooked Game vs. rescue-
      flavored ones like Missing Healer/Escort Risk). That existing thematic tagging could
      plausibly seed what *kind* of encounters a given contract's chain contains, tying
      generation, resolution, and narrative together — worth evaluating when this is
      actually scoped, not a settled design.
  - Open questions still unresolved:
    - How many encounters per contract, and does that vary by tier/duration, or is it fixed?
    - Do injury/death rolls move to per-encounter (more granular, more narrative material —
      "injured in the second encounter") instead of the current single post-resolution roll?
    - `CONTRACT_TIER_CONFIG`'s `powerRange`s were carefully calibrated (2026-07-08) against
      the current single-roll `estimateSuccessChance` formula — a chained-encounter model
      changes the underlying difficulty math entirely and would need its own fresh balancing
      pass, not a reuse of today's numbers.
    - Does this apply to all four tiers, or only to dangerous/legendary (errand/standard's
      short duration and low stakes may not suit multi-encounter treatment)?
    - Mechanically, how does "a relevant role helps this encounter" actually modify the math —
      a flat bonus to that encounter's effective power, a bonus to its success chance
      directly, or something closer to today's unmet-requirement penalty but inverted (a
      bonus for a *met* affinity instead of just a penalty for an unmet requirement)?
- Property system overhaul (2026-07-08, in progress — working through one property at a
  time with the user). **Audit finding that kicked this off**: of the six property types,
  only Dormitory (roster cap) and Training Hall (power rating) actually do anything
  mechanically. Infirmary reduces injury *chance*, not recovery time as its own description
  claims. Library, Alchemy Lab, and Armory are pure gold sinks today — buildable,
  upgradeable, charging daily maintenance forever, with zero effect: their catalog `bonus`
  values (`xpMultiplier`, `powerRatingBonus`, `wageDiscount`) are never read by any game
  logic. The frontend catalog copy (`Properties.tsx`) promises even more than the backend
  config does — per-vocation bonuses and stat bonuses (Cunning, Might) that don't exist
  anywhere in the `PropertyBonus` type at all. Working through each property one at a time
  to close these gaps with real, wired-up mechanics rather than leaving them decorative.
  - [x] **Dormitory** (2026-07-08): confirmed as roster-expansion-only, formalized. Its
    `xpMultiplier: 1.1` config value was already dead (never read anywhere — `computeRosterCap`
    is the only thing that ever looks at a dormitory), so this was a documentation/cleanup
    change rather than a mechanic removal: dropped the dead bonus from `PROPERTY_CONFIG` in
    `routes/properties.ts`, and fixed `Properties.tsx`'s catalog copy (description +
    `bonusSummary`) to describe roster capacity instead of the XP/morale bonus it never
    actually granted. Deliberate design call for the rest of this pass: keep Dormitory's role
    scoped to roster capacity only, and give a *different* property (Library is the leading
    candidate, given its existing copy and dead `xpMultiplier: 1.2`) the real XP bonus, so the
    two don't functionally overlap once both are wired up.
  - [x] **Infirmary** (2026-07-08): switched from reducing injury *chance* to reducing
    recovery *time*, matching its name, its existing frontend description ("reduce injury
    recovery time"), and its own long-dead `injuryRecoveryRate` bonus field, which had never
    been read by anything. Confirmed with the user: single-purpose (recovery time only), not
    both — injury-chance reduction is retired from Infirmary rather than kept alongside the
    new mechanic, consistent with the same "minimize functional overlap" principle from
    Dormitory. It could resurface later on Training Hall (conditioning/prep preventing injury
    in the first place would fit that property's existing theme) when that one gets its pass,
    but that's an open question for then, not decided now.
    - Recovery time formula: `recoveryHours = round(baseRoll * max(0.25, 1 - level *
      injuryRecoveryRate))`, where `injuryRecoveryRate` (0.15 = 15%/level) is now read
      directly off the property row rather than hardcoded in `adventure.ts` — matching the
      existing pattern Training Hall's power bonus already uses (source of truth lives once,
      in `routes/properties.ts`'s catalog, at build time), rather than the pattern Infirmary
      itself used previously (a hardcoded constant that ignored whatever was actually stored
      on the property). At the level-3 cap this is a 45% reduction; the 25% floor is a
      forward-compatible safety valve that doesn't bind at today's level cap but guards the
      formula if levels are ever raised.
    - Removed `MIN_SUCCESS_INJURY_CHANCE`/`MIN_FAILURE_INJURY_CHANCE`/
      `INFIRMARY_INJURY_REDUCTION_PER_LEVEL` from `adventure.ts` — all three existed solely to
      support the old injury-chance-reduction floor, which no longer exists. Simplified
      `injuryChance` to just `baseInjuryChance + temperament bump`, dropping a `Math.max()`
      that had become a permanent no-op once the infirmary subtraction was removed (the base
      injury-chance constants were already comfortably above their own floors).
    - Preserved the exact `Math.random()` call structure (roll for recovery hours still only
      happens inside the `injured && !dead` branch) specifically to avoid reshuffling the
      mocked-value sequences in every other test in `adventure.test.ts` — a lesson carried
      over from the Temperament work earlier this session, where a new unconditional call
      broke several `mockReturnValueOnce` chains.
    - Incidentally found and fixed while in the area: `Dashboard.tsx`'s built-property bonus
      display formatted every numeric bonus as if it were an XP-style multiplier
      (`(v-1)*100%`), which would have rendered a plain fraction like the new
      `injuryRecoveryRate: 0.15` as a nonsensical "+0.15" and a flat `powerRatingBonus: 2` as
      "+100%" (a pre-existing, unrelated display bug for Training Hall, not something this
      change introduced). New `formatBonusValue()` helper distinguishes multiplier/fraction/
      flat-count values properly. Also fixed a leftover empty-state string ("a dormitory
      improves adventurer retention") that predated last turn's Dormitory scoping fix.
    - Test-covered in `test/adventure.test.ts`: recovery hours reduced by the expected amount
      at max infirmary level, and a regression guard confirming a roll that would have been
      "safe" under the old chance-reduction formula still results in injury now.
  - [x] **Training Hall** (2026-07-08): dropped its dead `xpMultiplier: 1.15` promise, same
    call as Dormitory and Infirmary — power rating only, XP stays reserved for Library.
    Confirmed with the user: the working half of Training Hall (power rating) was also
    under-tuned for higher-tier play — a flat `+2/level` (max +6 at level 3) added *once* to
    the party's total, against a scale where legendary contracts require 140-280 combined
    power and a single well-built level-6 adventurer can approach 90+ power alone. Redesigned
    to a **percentage of total party power** instead: `+10%/level`, up to +30% at level 3 —
    the same shape of mechanic Cohesion already uses, so it scales correctly regardless of
    contract tier or party size instead of becoming trivial at endgame.
    - New shared `computeTrainingHallBonus()` in `packages/types/src/game.ts` (mirroring
      `computeCohesionBonus`), used by both `computePartyPower` in `services/adventure.ts`
      (the real roll) and a new `trainingHallBonus()` helper in the frontend's
      `lib/cohesion.ts` (the live party-assembly preview on the Dashboard and Contract
      Market) — so the two can't drift, same reasoning as Cohesion's shared function.
    - Training Hall and Cohesion combine **additively**, not multiplicatively/compounded
      (`basePower * (1 + trainingBonus + cohesionBonus)`) — a deliberate choice so the total
      bonus stays a simple sum as more power-affecting properties get built out, rather than
      compounding into an increasingly extreme multiplier. Test-covered specifically as a
      regression guard, since a roll was chosen that only succeeds under one of the two
      models.
    - **Fixing the frontend preview gap surfaced this needed fixing now, not later**: the
      three party-assembly previews (Dashboard, Contract Market) never included Training
      Hall's bonus at all, even before today — a pre-existing gap noted (and deliberately
      left alone) during the Cohesion work, when it was only worth a few flat points. Now
      that it's worth up to 30% of party power, leaving it out would have made the displayed
      success chance meaningfully wrong for anyone who owns a Training Hall, so it was fixed
      as part of this change rather than deferred again. `AdventureDetail.tsx` (a read-only
      view of an already-committed party, not a decision point) remains the one preview left
      out, consistent with the reasoning already established for it.
    - `Dashboard.tsx`'s bonus-value formatter (`formatBonusValue`, added last turn for
      Infirmary) needed to become property-type-aware: `powerRatingBonus` is now a *fraction*
      for Training Hall but is still a flat, dead value for Alchemy Lab (not yet redesigned),
      so the same JSON key means different things depending on which property owns it.
    - Test-covered in `packages/types/src/game.test.ts` (scales with level, ignores
      `powerRatingBonus` on non-training-hall properties) and `test/adventure.test.ts`
      (training bonus alone flips a contract outcome; additive-not-multiplicative combination
      with Cohesion verified via a roll that only succeeds under one model).
  - **New direction, confirmed with the user (2026-07-08)**: beyond fixing dead bonuses, the
    remaining properties (and possibly a new one) should interact with adventurer *vocations*
    meaningfully, not just be interchangeable stat sticks. Vocations are grouped into the
    classical fantasy party roles (fighter/wizard/rogue/priest), and each role gets its own
    property. This also lays groundwork for a **planned future feature**: contracts favoring
    certain party compositions by role — not built yet, but the taxonomy below is designed to
    support it without rework. (Fleshed out into its own full entry, "Party vocation/role
    synergies," in Beta Phase 2 below.)
    - New shared taxonomy in `packages/types/src/game.ts`: `PartyRole` type,
      `VOCATION_PARTY_ROLE` (vocation -> role), `PROPERTY_PARTY_ROLE` (property type -> role
      it serves), and `findRolePropertyBonus()` (shared lookup used by both `resolveAdventure`
      and the daily wage/loyalty cycle, so the matching logic isn't duplicated).
    - Confirmed grouping: **Fighter** = Sellsword, Outrider (-> Armory). **Wizard** = Arcanist,
      Invoker (-> Library). **Rogue** = Trickster, Alchemist (-> Alchemy Lab). **Priest** =
      Mender (-> no property yet, see below). All three existing property names/descriptions
      already leaned this direction before today (Armory: "improves Might for combat
      contracts"; Library: "lore, maps, strategic texts"; Alchemy Lab: named directly after
      the Alchemist vocation) — this formalizes what was seemingly the original intent and
      never finished.
    - **Chronicler intentionally has no role yet.** It doesn't cleanly fit either Wizard
      (arcane scholar reading) or Priest (support/wisdom reading) — the user wants to
      reconsider whether Chronicler itself should be reworked into something that fits the
      Priest archetype better, rather than force-fitting the existing vocation into a role it
      doesn't really suit. `VOCATION_PARTY_ROLE` simply has no entry for it, which is the
      correct behavior until this is decided — Chronicler-vocation adventurers just don't
      participate in any role-property bonus yet. Revisit when Library (Wizard) or the new
      Priest property gets its turn.
    - **A new Priest-role property is confirmed but not yet built** (no name chosen yet —
      candidates like "Chapel"/"Sanctuary" not decided). Deferred until its vocation
      membership is settled (Mender alone, or Mender + a reworked Chronicler) and until this
      pattern has been proven out on Armory first.
  - [x] **Armory** (2026-07-08) — first role-property built out, chosen as the lowest
    thematic lift (its existing copy already described combat/Might). Dropped the dead
    `wageDiscount` entirely (never read anywhere, like every other property's cleanup this
    pass) and replaced it with two mechanics for fighter-role vocations (Sellsword, Outrider)
    specifically — not the whole party regardless of vocation, matching how Ambition/
    Temperament bonuses are already per-adventurer, not party-wide:
    - **XP bonus**: `xpBonusPerLevel: 0.10` (+10%/level, up to +30% at level 3), applied in
      `resolveAdventure`'s per-adventurer XP calc as another multiplicative factor alongside
      the existing Ambition multiplier.
    - **Loyalty recovery bonus**: `loyaltyRecoveryBonus: 1` (+1 extra `loyaltyPenalty` point
      recovered per day per level, on top of the existing flat -1/day base), applied in
      `services/economy.ts`'s daily wage cycle. **Deliberately paired with the XP bonus on
      the user's explicit reasoning**: XP alone becomes worthless once an adventurer hits
      `MAX_LEVEL` and can't gain more levels, so a property built purely around XP stops
      mattering for veteran adventurers exactly when a player has invested the most in them.
      The loyalty half keeps Armory valuable for retention regardless of level.
    - Both mechanics read their per-level rate off the property row itself (matching the
      Infirmary/Training Hall pattern established this session), rather than a hardcoded
      constant, so the source of truth stays in one place (`routes/properties.ts`'s catalog).
    - `economy.ts`'s `processPlayerWages` now fetches the player's properties once per call
      (previously fetched none at all) to support the loyalty-recovery lookup.
    - Test-covered in `packages/types/src/game.test.ts` (`findRolePropertyBonus` — applies
      for a matched role, zero for an unassigned vocation like Chronicler, zero for a
      mismatched role, zero with no properties) and both `test/adventure.test.ts` (XP bonus
      granted for Sellsword, withheld for Arcanist) and `test/economy.test.ts` (loyalty
      recovery boosted for Sellsword, unaffected for Arcanist).
  - [x] **Library** (2026-07-08) — second role-property, wizard (Arcanist, Invoker). Before
    building, confirmed with the user whether to reuse Armory's exact mechanic pair or give
    Library something distinct (the original brainstorm included a third idea — a permanent
    stat bump on level-up); decided to reuse the same pair for now and table the stat-bump
    idea for a *different*, non-role-vocation property later rather than build it into this
    batch. Same rates as Armory: `xpBonusPerLevel: 0.10`, `loyaltyRecoveryBonus: 1`. Dropped
    the dead `xpMultiplier` field entirely — with Library's removal it's now unused by every
    property, so it's gone from the `PropertyBonus` interface too, not just left dead on one
    property like the others were mid-pass.
    - **Found and fixed a labeling bug this reuse would have caused**: `Dashboard.tsx`'s
      bonus-value labels (`XP gain (fighters)`, `Loyalty recovery (fighters)`, added for
      Armory) would have been wrong for Library, which reuses the identical JSON keys for a
      different role. Generalized to a `bonusLabel()` helper that looks up the role a given
      property actually serves (`PROPERTY_PARTY_ROLE`) and labels it dynamically — "XP gain
      (wizards)" for Library, "XP gain (fighters)" for Armory, from the same code path.
    - Test-covered in `packages/types/src/game.test.ts` (a wizard vocation matches Library
      independent of an owned Armory; a fighter vocation still only matches Armory when both
      are owned) and the same XP/loyalty pattern as Armory in `test/adventure.test.ts` and
      `test/economy.test.ts`, using Arcanist in place of Sellsword.
  - [x] **Alchemy Lab** (2026-07-08) — third role-property, rogue (Trickster, Alchemist).
    Same mechanic pair and rates as Armory/Library, confirmed with the user upfront rather
    than re-litigated. Dropped the dead `powerRatingBonus: 3` (never read — `computePartyPower`
    only ever looked at `training_hall`). **This was the last property with a dead bonus
    field** — all six now have a real, working mechanic (Dormitory: roster cap, Training
    Hall: party power, Infirmary: recovery time, Armory/Library/Alchemy Lab: role-vocation
    XP + loyalty recovery).
    - Simplified `Dashboard.tsx`'s bonus-value formatter now that this was the only other
      property using `powerRatingBonus` (alongside Training Hall) — the property-type-aware
      branch added for exactly this ambiguity is gone, since `powerRatingBonus` now
      unambiguously belongs to Training Hall alone and always means "fraction of party
      power." `formatBonusValue()` dropped its now-unused `propertyType` parameter.
    - Test-covered identically to Armory/Library in `packages/types/src/game.test.ts`,
      `test/adventure.test.ts`, and `test/economy.test.ts`, using Trickster in place of
      Sellsword/Arcanist.
  - [x] **Chronicler renamed and reworked to Chanter, resolving the priest question**
    (2026-07-08). The reskin-vs-replace decision came down to identity: "Chronicler" means
    historian/record-keeper, and its own tier titles ("Lorekeeper," "Sage") reinforced that
    reading — no amount of retitling the upper tiers fixes what the base name and its whole
    surrounding flavor already commit to. Replaced instead of force-fit.
    - New vocation `Chanter` (`VOCATIONS` in `packages/types/src/game.ts`), titles
      `Chanter → Liturgist → Hierophant`, stat priority `Influence, Cunning, Attunement` —
      Influence-primary to match Mender (the other priest-role vocation), Cunning kept as a
      secondary nod to the old vocation's ritual/lore roots rather than dropped entirely, so
      it's related to but distinct from Mender's own `Influence, Attunement, Grit` profile.
      `VOCATION_PARTY_ROLE.Chanter = 'priest'` — every vocation now has an assigned role.
    - `vocation` is a plain string column (no Prisma enum), so this was a data fix, not a
      schema migration: new standalone script `prisma/renameChroniclerToChanter.ts`
      (`pnpm db:migrate:chanter`, mirroring `seedWiki.ts`'s runnable-standalone pattern)
      renames every existing `vocation: 'Chronicler'` adventurer to `'Chanter'` in place,
      keeping their level/stats/history — idempotent, safe to run more than once.
    - Also updated the Vocations wiki page's template table in `seedWiki.ts` (only affects
      fresh-seeded wikis; the live wiki content needs the same edit pasted in manually via
      the in-app editor, same as any other wiki content change).
    - Test-covered in `packages/types/src/game.test.ts` (Chanter groups with Mender under
      priest; every vocation now has an assigned role) and updated the one test whose
      unassigned-role case relied on Chronicler's old absence to use a synthetic vocation
      instead, since that scenario no longer exists for real data.
  - [x] **Sanctuary** (2026-07-08) — fourth and last role-property, priest (Mender, Chanter).
    User proposed the name directly; kept it as-is — single word, matches the naming
    convention of every other property (Armory, Library, Infirmary, Dormitory), evokes
    reflection/ritual without being denominationally specific, in keeping with Chanter's own
    "Liturgist/Hierophant" flavor without leaning fully into an organized-church aesthetic.
    Same mechanic pair and rates as Armory/Library/Alchemy Lab (`xpBonusPerLevel: 0.10`,
    `loyaltyRecoveryBonus: 1`), priced at 425 base / 24 daily maintenance — between Library
    (400/25) and Armory (450/22), no existing properties undercut or exceeded.
    - **Unlike every other property change this pass, this one needed an actual schema
      migration.** `PropertyType` is a genuine Prisma enum (`vocation` on the other hand is a
      plain string column, which is why the Chanter rename the previous turn was a data fix,
      not a migration) — added `sanctuary` to the enum in `schema.prisma`, plus the matching
      entries in `packages/types/src/game.ts`'s `PropertyType` union and
      `PROPERTY_PARTY_ROLE`, the Zod enum and catalog entry in `routes/properties.ts`, and the
      catalog/label entries in both `Properties.tsx` and `Dashboard.tsx`.
    - **All four classical party roles now have both a vocation pairing and a property**:
      Fighter (Sellsword, Outrider → Armory), Wizard (Arcanist, Invoker → Library), Rogue
      (Trickster, Alchemist → Alchemy Lab), Priest (Mender, Chanter → Sanctuary). This closes
      out the vocation-role property arc started with the Dormitory/Armory conversations.
    - Test-covered identically to Armory/Library/Alchemy Lab in
      `packages/types/src/game.test.ts`, `test/adventure.test.ts`, and `test/economy.test.ts`,
      using Mender in place of Sellsword/Arcanist/Trickster.
  - [x] **Normalized vocation-property costs** (2026-07-08) — Armory, Library, Alchemy Lab,
    and Sanctuary previously had slightly different costs (400-500 base, 22-30 daily
    maintenance) left over from being priced one at a time as each was built out. Since the
    four are otherwise perfectly symmetric (identical `xpBonusPerLevel`/
    `loyaltyRecoveryBonus` mechanic, differing only in which vocation role they favor),
    normalized all four to **500 base cost / 30 daily maintenance**, reusing Alchemy Lab's
    existing values (already at the 500 tier) rather than inventing new numbers. Upgrade
    cost (150 → 350 across levels) and maintenance scaling (+50% of base per level above 1)
    were already global mechanisms shared by every property, not property-specific, so no
    formula changes were needed — normalizing the base numbers was sufficient to make all
    four identical in cost at every level. No test changes needed: every existing test that
    creates one of these four properties does so via a direct `prisma.property.create()` call
    with its own explicit `maintenanceCostDaily`, not by reading `PROPERTY_CONFIG`, so none
    of them actually asserted against the old catalog values in the first place.
  - [x] **Fixed stale property `bonus` JSON causing a +600% Training Bonus in production**
    (2026-07-08) — reported by the user: a level-3 Training Hall showed +600% instead of
    +30%. Root cause: every property-bonus redesign this project went through (Training
    Hall's flat-2 → fraction-0.1, Infirmary's dead-2.0 → real-0.15, Armory/Library/Alchemy
    Lab's `wageDiscount`/`xpMultiplier`/flat-`powerRatingBonus` → `xpBonusPerLevel`/
    `loyaltyRecoveryBonus`) updated `PROPERTY_CONFIG` going forward but never touched
    already-existing property rows, which keep whatever `bonus` JSON they had at build time
    forever — the upgrade route only ever wrote `level`/`maintenanceCostDaily`/`costBasis`,
    never `bonus`. Training Hall was the one that surfaced *visibly wrong* rather than
    silently broken, because old and new both used the same key name (`powerRatingBonus`)
    with different meanings (flat vs. fraction): a pre-redesign row's stored `2 * level 3 =
    6` got reinterpreted under the new percentage formula as +600%. Infirmary's old value
    similarly clamps to the 25% recovery floor regardless of actual level under the new
    formula; Armory/Library/Alchemy Lab's old keys don't exist under the new schema at all,
    so pre-redesign rows of those types were silently granting **zero** bonus instead of a
    visibly wrong one — same underlying bug, just not one that produces an alarming number
    on screen.
    - **Process gap, not a one-off mistake**: this happened because `PROPERTY_CONFIG` lived
      directly in `routes/properties.ts` with no mechanism forcing existing rows to stay in
      sync, and — unlike the Chronicler→Chanter vocation rename, which got an explicit
      migration script at the time — none of the property-bonus redesigns this session got
      a corresponding data migration.
    - Extracted `PROPERTY_CONFIG`/`UPGRADE_COSTS` out of `routes/properties.ts` into a new
      `services/propertyCatalog.ts`, the single source of truth both the route and the new
      migration script import from, rather than risking a second catalog drifting out of
      sync with the first.
    - New one-off `prisma/syncPropertyBonuses.ts` (`pnpm db:sync:property-bonuses`, same
      standalone-runnable pattern as `renameChroniclerToChanter.ts`) re-syncs every existing
      property row's `bonus` to its type's current catalog value, regardless of level —
      idempotent, safe to run again after any future bonus schema change too.
    - **Defensive fix so this can't recur silently**: the upgrade route now also re-writes
      `bonus: config.bonus` on every upgrade (previously only `level`/`maintenanceCostDaily`/
      `costBasis`), so a property at least self-heals the next time it's upgraded. This
      doesn't help an already-max-level property that's never upgraded again — the migration
      script is still what fixes those — but narrows the exposure window for the next redesign.
- [x] Raised the adventurer level cap from 6 to 10 (2026-07-08) — the 6-level cap was a
  placeholder from initial design, never deliberately tuned. Surfaced by a user question
  about vocation title tiers: `VOCATION_TIERS` already defined a third title tier
  (Ironclad/Ghost/Archon/etc.) gated at level 10, which was permanently dead content while
  `MAX_LEVEL` was 6 — nobody could ever reach it. Fixed both sides: raised `MAX_LEVEL` to 10
  and set the new user-specified tier boundaries (1-4 → base title, 5-8 → mid title, 9-10 →
  top title, in `AdventurerCard.tsx`'s `tierIndex` calc) so the top tier is actually
  reachable now.
  - `XP_TO_LEVEL` (`packages/types/src/game.ts`) extended for levels 7-10 by continuing the
    exact doubling curve already established by levels 3-6 (each level's XP jump is exactly
    2x the previous — 250, 500, 1000, 2000 — so 4000/8000/16000/32000 for the new levels),
    rather than inventing new tuning: 7,850 / 15,850 / 31,850 / 63,850.
  - No test changes needed — `game.test.ts`'s `levelForXp` tests already iterate
    symbolically from `2` to `MAX_LEVEL` against `XP_TO_LEVEL[lvl]`, so they automatically
    extended their own coverage to the new levels without modification.
  - **Flagged but not touched, since they weren't part of what was asked**: `minSatisfyingTier`
    (the Ambition mechanic's contract-tolerance curve) still caps out at "dangerous" for any
    level above 4 — a level 10 adventurer has the identical tolerance floor as a level 5 one,
    so the new level range doesn't get its own tolerance stratification. Still open. (The
    other flagged item — contract power ranges being too low for the new level ceiling — was
    resolved the same day; see the entry directly below.)
- [x] Recalibrated Standard/Dangerous/Legendary power ranges against the adventurer title
  tiers (2026-07-08) — the previous ranges (standard 25-70, dangerous 70-140, legendary
  140-280) were flagged as a balance concern right after the level-cap change, and the user
  confirmed with a concrete example: a full party of six level 1-3 adventurers could already
  clear legendary (the old 140-280 range) at ~90% success. Root cause once worked through the
  actual formula: `estimateSuccessChance` is `0.3 + ratio×0.5` capped to [30%, 90%], so a
  party merely *matching* required power already gets 80% — hitting the 90% cap only needs
  120% of required power. Combined with power scaling roughly linearly at ~12.5/level per
  adventurer (~75/level for a full 6-person party, derived from the 3d6+2 stat-roll average)
  and this session's power-boosting mechanics (Cohesion, Training Hall) stacking on top, the
  old ranges were calibrated for a much smaller effective party power than a real 6-person
  roster produces.
  - New ranges calibrated against the adventurer title tiers directly (tier 1 = levels 1-4,
    tier 2 = 5-8, tier 3 = 9-10; see `VOCATION_TIERS`) and a full party of 6: each tier's
    `max` is set so the tier's lowest level gets roughly a 50% shot (a genuine coin flip,
    the difficulty target the user confirmed) against the hardest contract the tier can
    roll; `min` is set so the tier's highest level clears the 90% cap against the easiest
    roll. **Standard: 100-190. Dangerous: 500-940. Legendary: 625-1700.** Errand
    deliberately untouched (5-25) — stays easy on purpose, a way for new players to earn
    gold regardless of roster strength, per explicit instruction.
  - Tier 1 (Standard) is a special case worth noting: its power growth across levels 1-4 is
    4x, wide enough that the "50% at the low end" and "90% at the high end" constraints
    don't both bind the same way they do for tiers 2/3 — a level-4 party already clears the
    low end of the range well past the 90% cap. That's expected, not a bug: you're meant to
    be outgrowing Standard by the time you're near the top of tier 1.
  - Tier 3 (Legendary) is the opposite case: only an 11% power spread between its own low
    (level 9) and high (level 10) end, so almost all of its difficulty variance has to come
    from the requiredPower *range* itself rather than the level gap — reflected in that
    range's width (625-1700, a 2.7x spread) being the largest of the three.
  - **Deliberately not touched, flagged for a possible follow-up**: `rewardRange` for these
    three tiers is unchanged, even though `powerRange` moved up dramatically (dangerous
    ~7x, legendary ~4-6x at the midpoint). Contracts now demand meaningfully stronger
    parties for the same gold payout as before — not necessarily wrong (risk/reward framing
    is a separate design question from raw difficulty), but worth a deliberate look rather
    than assuming the existing reward numbers are still well-tuned against the new power
    requirements.
  - No test changes needed — `contracts.test.ts`'s range-check test reads `cfg.powerRange`
    dynamically from `CONTRACT_TIER_CONFIG` rather than hardcoding the old bounds, and no
    API test relies on tier-derived `requiredPower` (`createContract`'s fixture default is
    a fixed, tier-independent value), so the new ranges needed no test updates to stay green.
- [x] Contract market scales with player population; capped direct-accept hoarding
  (2026-07-09) — raised as a scaling concern: errand/standard generated a fixed daily batch
  (5/8) regardless of how many players were actually on the guild roster, which wouldn't
  hold up past a couple of active players. Two design options were on the table — a shared
  market scaled by active-player-count, vs. private per-player daily pools for
  errand/standard. Went with the shared, population-scaled option: dangerous/legendary
  already need to stay a shared competitive pool (bidding requires cross-player visibility),
  so a private-pool split would've left the market page presenting two different mental
  models side by side; the population-scaled option also directly extends a pattern already
  proven in this codebase (`dailyReset.ts`'s adventurer-pool sizing, which already scales off
  a 7-day "took some action" active-player count) rather than introducing a second,
  structurally different mechanism alongside it.
  - New `services/activity.ts` extracts that exact 7-day active-player query (previously
    inlined in `dailyReset.ts`) into a shared `getActivePlayerCount()`, reused by both the
    adventurer pool and the contract market so they scale off one consistent definition of
    "active."
  - New `CONTRACT_MARKET_BASE_RATE` (`packages/types/src/contracts.ts`) replaces the old
    fixed `DAILY_CONTRACT_COUNTS`/`BIDDING_MARKET_TARGET`, giving all four tiers — not just
    dangerous/legendary — the same per-active-player rate (errand 5, standard 8, dangerous 5,
    legendary 2, unchanged from the prior fixed numbers). `services/marketSeeding.ts`'s new
    `replenishContractMarket()` generalizes the old dangerous/legendary-only standing-target
    top-up to cover all four tiers on `marketGC`'s existing 15-minute cycle, targeting
    `max(rate, ceil(rate × activePlayerCount))`. The `max(rate, …)` floor is a deliberate
    addition beyond what was asked: without it, zero active players (a fresh deploy, or a
    lull before anyone's activity clears the 7-day window) computes a target of zero and
    locks the market empty — including for a brand-new player, since their first session
    doesn't count as "active" under the existing definition (no hire/build/sell/adventure
    yet), which would otherwise be a bootstrapping deadlock. The floor just reduces to
    today's original fixed numbers in that case, so it's not expected to be visible at
    today's playtest population. `dailyReset.ts` no longer seeds contracts at all — that
    responsibility moved entirely to the reactive top-up, and admin's "Seed Contracts" button
    now calls the unified top-up for all tiers instead of two separate calls.
  - Second, related concern raised in the same conversation: with no reputation gate on
    errand/standard (deliberate, so new players are never locked out — see
    `CONTRACT_TIER_REPUTATION_REQUIREMENTS`), a bad actor could accept every errand/standard
    contract on the market for free and just let each one lapse, denying them to every other
    player. The existing `deployBy` penalty (see the unbounded-hoarding fix above) already
    costs a player who does this — but only in gold/reputation, not in market availability
    for others while they're doing it. New `MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS = 3` caps
    how many contracts a player can simultaneously hold in `'awarded'`-but-undeployed limbo;
    accepting a fourth returns a 409 until one deploys or resolves. Scoped to errand/standard
    only — dangerous/legendary already require clearing a reputation gate and winning a
    competitive bid, a much higher-effort path than a free direct accept, so weren't judged
    worth the added complexity of also skipping an at-cap winner in `marketGC`'s bid-award
    loop.
  - Accept logic extracted from the router into a new `services/contracts.ts`
    (`acceptContract()`), matching this codebase's existing thin-router-over-service-function
    convention (`services/adventure.ts`, `services/bootstrap.ts`) so the cap check — and the
    tier/status/expiry checks and atomic claim it now sits alongside — is unit-testable
    directly rather than only reachable through an HTTP layer this test suite doesn't cover.
  - Test-covered in `packages/types/src/contracts.test.ts` (new `CONTRACT_MARKET_BASE_RATE`
    values), `packages/api/test/marketGC.test.ts` (all four tiers top up from empty, target
    scales with active-player count, floor holds at zero active players), and new
    `packages/api/test/contracts.test.ts` (cap enforcement, cap not affected by in-progress/
    resolved/bidding-tier contracts). Typecheck/tests/build all verified clean by the user
    before this entry.

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
- **Gold-sink angle** (noted 2026-07-09, during the late-game-gold-sink discussion that
  produced Adventurer Equipment above): attaching a gold cost to these cosmetics once built
  would double as another late-game sink, purely cosmetic so it sidesteps power-balance
  concerns entirely. Not scoped further — blocked on an actual art/asset production decision
  (procedural generation, a curated image set, or similar) before design can meaningfully
  proceed, which is why this wasn't chosen to build first.

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
- **Gold-sink angle** (noted 2026-07-09, during the late-game-gold-sink discussion that
  produced Adventurer Equipment in Beta Phase 2): the "build an office" language above
  already implies a real gold cost to expand into each new region — a naturally large,
  later-payoff sink once this phase is actually reached. Deliberately not chosen to build
  first: this is the roadmap's single largest item, several phases ahead of where the game
  currently is, and building even just the office cost now would mean scoping real region
  infrastructure ahead of everything else queued first.

## Post-Beta — Native Mobile App
**Goal:** a native mobile client listed on the Apple App Store and Google Play, so players
can play natively on their phones rather than through a mobile browser. Explicitly
independent of Beta Phase 1's mobile-friendly *web* layout item above — that item makes the
existing site usable on a phone's browser; this is a separate native application entirely,
and doesn't depend on or replace it (the responsive web pass should still happen regardless
of whether this is ever built). Deliberately ambitious/exploratory — no scoping done yet.

- No platform decision made yet — needs its own research/decision pass before any
  implementation: a cross-platform framework (e.g. React Native, matching the existing
  React/TS skillset in `packages/frontend`) vs. two fully separate native codebases, vs. a
  wrapped/packaged version of the existing web app (e.g. Capacitor) as a faster but lower-
  quality-ceiling starting point.
- API surface is likely mostly reusable as-is (`packages/api`'s REST endpoints + Redis
  pub/sub-backed SSE for real-time updates aren't web-specific), but push notifications
  (contract deadlines, adventure completions, deploy-by warnings) would be a genuinely new
  capability the current web app doesn't have, and mobile SSE/backgrounding behavior needs
  its own investigation rather than assuming parity with the browser.
- Clerk auth would need its native/mobile SDK integration rather than the current web flow.
- App store distribution brings its own new scope: developer account setup for both stores,
  store review/compliance requirements, app store listing assets, and a release/update
  pipeline distinct from the current `flyctl deploy` web flow.

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
