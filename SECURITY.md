# Security Practices

This document exists because Axes & Actuaries is a live, multiplayer game with a real
in-game economy and real user accounts (via Clerk). It records the security-relevant
patterns this codebase already relies on, so they stay consistent as new routes and
features are added, plus known gaps that are tracked deliberately rather than silently.

## Reporting a vulnerability

If you find a security issue, report it privately rather than opening a public GitHub
issue — contact the maintainer directly. Do not test exploits against production data
beyond what's needed to demonstrate the issue.

## Authentication and authorization

- Every authenticated route uses the shared `requireAuth` middleware
  (`packages/api/src/middleware/requireAuth.ts`), which verifies the Clerk session and
  resolves it to an internal `req.playerId`. **Do not hand-roll `getAuth(req)` checks in
  a route** — a previous one-off implementation in `routes/events.ts` diverged just
  enough (keying an SSE connection by the raw Clerk `userId` instead of `req.playerId`)
  to silently break per-player real-time delivery. If a route has unusual auth needs
  (e.g. SSE, webhooks), extend `requireAuth` or add a clearly-scoped variant — don't
  reimplement the check inline.
- Every route that reads or mutates player-owned data (adventurers, properties,
  contracts, adventures) must filter by `req.playerId` and verify ownership before
  acting — see `routes/properties.ts`'s `property.playerId !== req.playerId` checks as
  the pattern to follow. Missing this is a direct IDOR vulnerability.

## Concurrency: the atomic-claim pattern

Any endpoint that checks a precondition and then acts on it (check-then-act) is a race
condition waiting to happen if two requests can run concurrently — a player firing
duplicate/parallel requests can exploit the gap between the check and the write. This
codebase has been bitten by this three times already (contract double-fulfillment,
welfare-cooldown bypass, desperate-hire farming — all fixed).

The pattern to use:
- If the precondition can be expressed as a single row's state (e.g. "contract status is
  `awarded`", "player's `lastWelfareAt` is past cooldown"), use an atomic
  `updateMany({ where: { ...precondition }, data: {...} })` and check `count` — if it's
  `0`, the claim lost the race. See `services/adventure.ts`'s `startAdventure` and
  `services/bootstrap.ts`'s `claimWelfareContract`.
- If eligibility is a derived condition across multiple rows (e.g. "player has zero
  adventurers, zero properties, and insufficient gold"), there's no single row to gate an
  atomic `updateMany` on — use a Postgres `Serializable` transaction instead and re-verify
  the condition inside it, catching Prisma's `P2034` (serialization conflict) on the
  losing side. See `services/bootstrap.ts`'s `claimDesperateHire`.
- Never check a precondition outside a transaction and then act on it in a separate step
  — always re-verify (or atomically claim) at the point of the write.

## Secrets and environment variables

- `.env` and `.env.local` are gitignored — never commit real keys. `.env.example`
  documents every variable with placeholder values.
- Variables prefixed `VITE_` are baked into the public frontend bundle at **build** time
  and are visible to anyone who opens the browser's dev tools — they are not secrets.
  `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_SENTRY_DSN` are both intentionally public-safe
  values (a Clerk publishable key and a Sentry DSN only allow sending data in, not reading
  it back out). Never put an actual secret (API tokens, database credentials, Clerk's
  *secret* key) behind a `VITE_` prefix.
- Runtime secrets (`DATABASE_URL`, `CLERK_SECRET_KEY`, `SENTRY_DSN`, `FLY_API_TOKEN`) live
  in Fly.io secrets / GitHub Actions secrets, injected as real environment variables —
  never baked into the Docker image or committed anywhere.

## Dependency hygiene

- Run `pnpm audit` periodically (not currently wired into CI) and address anything
  flagged, especially in `packages/api` given its direct database/auth exposure.
- Keep Node, Prisma, and Sentry on supported/patched versions. Prisma in particular has
  had real Alpine/OpenSSL compatibility bugs (see the Node 22 migration in `ROADMAP.md`)
  — a version bump that touches the Docker base image should be verified with an actual
  `docker build` + `docker run`, not just `pnpm typecheck`.

## HTTP hardening

- `helmet` is enabled in `packages/api/src/index.ts` for standard security headers
  (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.).
- **Content-Security-Policy is deployed in Report-Only mode** (`reportOnly: true` in
  `packages/api/src/index.ts`) — it logs violations to the browser console without
  blocking anything, pending a period of real production usage to confirm the policy is
  complete (Clerk's hosted `<SignIn>`, Google Fonts, Sentry's ingest endpoint, this app's
  own inline `style={{}}` usage) before switching to enforcement. Only ever applies in
  production — Express serves the built frontend (and its `helmet` headers) only when
  `NODE_ENV=production`; local Vite dev never goes through this middleware at all. Clerk's
  FAPI hostname is the custom domain `clerk.axesandactuaries.com` — if that ever changes in
  Clerk Dashboard → Domains, update the CSP directives to match.
- CORS is restricted to a single configured origin (`FRONTEND_URL`), not a wildcard.
- Rate limiting (`express-rate-limit`) is in-memory, keyed by IP, applied globally to
  `/api/`. This won't hold up across multiple Fly machines — see `ROADMAP.md`'s
  Redis-backed rate limiting item.

## Known follow-ups (tracked in ROADMAP.md, not silently deferred)

- Switch CSP from Report-Only to enforcing once a period of production usage confirms zero
  violations.
- Redis-backed (not in-memory) rate limiting.
- U.S./E.U. privacy regulatory compliance review.
- Admin/moderator roles — no privileged access model exists yet.
