# Plan: Community tab (share presets and setups)

Branch: `feature/community`. Status: **draft, waiting for approval**. Complexity: Large (new backend, auth, new screen).

## Goal
A Community screen where signed-in users publish pedal presets (`.prst`) with a description and tags, and anyone can browse, search, download/import, like and report them. One backend serves both the web build and the Electron app. SSO via **Google and GitHub** (Reddit dropped). MVP has no comments, profiles or IR/SnapTone sharing.

"Setup" = a preset plus free-text metadata (guitar, pickups, genre, notes). Not a separate entity in MVP.

## Patterns to mirror (from the codebase)
| Area | Source | Pattern |
|---|---|---|
| Host API | `src/shared/host.ts`, `src/shared/host/tones.ts` | one interface file per domain, composed into `HostApi`; add `community: CommunityApi` |
| Web impl | `src/renderer/src/host/web/tones.ts` | one `webX` object per domain, registered in `host/web/index.ts` |
| Electron impl | `src/preload/tones.ts`, `src/main/ipc/tones.ts`, `src/main/tone3000/*` | preload `invoke("x:y")` -> main IPC; tokens stay in main (keychain), renderer never sees them |
| Errors | `HostError` from `@shared/ipc` (`"unsupported"`, `"network"`, `"invalid"`, `"not-found"`) | reuse the same codes |
| Screen | `src/renderer/src/screens/tones/` (`TonesScreen.tsx`, `store.ts` zustand, `*.test.ts`) | screen folder + zustand store + colocated tests |
| Nav | `state/nav.ts` (`Screen` union), `app/Rail.tsx` `ITEMS`, `?screen=` launch param | add `"community"` to all three, plus a command-palette entry (`app/commands.ts`) |
| Preset import | `host/web/files.ts`, `state/preset-codec.ts`, `gp5/lib/prst.mjs` | reuse the existing parse/sniff/CRC code for server validation and for import into the Library |
| Isolation headers | `public/_headers` (added for web build) | already COOP/COEP `credentialless`; third-party avatars need CORP or must be proxied (see risks) |
| Tests | vitest, `src/**/*.test.{ts,tsx}`, jsdom | pure-logic tests; no framework for the Worker beyond vitest node env |

No existing server, auth or database code exists. Nothing to mirror there.

## Architecture
```
Browser (web build) --same origin, HttpOnly cookie--> Worker (/api/*)  --> D1 (metadata), R2 (.prst)
Electron renderer --IPC--> main (bearer token in safeStorage) --HTTPS--> Worker
```
- **One Worker** serves the static `dist-web` assets and `/api/*` (`assets.run_worker_first: ["/api/*"]`). Same origin on web, so no CORS and a plain cookie session.
- **Electron cannot receive a redirect on `app://`**, so sign-in uses the **system browser + device-code style polling** (no custom protocol, no loopback server):
  1. main creates a random `login_id`, opens `https://<site>/api/auth/<provider>/start?login=<id>` in the default browser;
  2. Worker runs the OAuth dance, on callback stores `login_id -> session token` in D1 (TTL 5 min, single use);
  3. browser shows "You can return to the app"; main polls `GET /api/auth/poll?login=<id>`, receives the token once, keeps it in `safeStorage`.
- Electron community calls go **through main** (matches Tones; avoids CORS from `app://` and keeps the token out of the renderer). Needs the site origin added to main's allowed network/CSP.
- Worker code lives in `app/worker/` (own `tsconfig.worker.json`, included in `typecheck`). Pure helpers (validation, ids, OAuth URL builders) are plain TS importable by tests.

## Data model (D1)
```
users      id, provider, provider_uid, name, avatar_url, role('user'|'admin'), accepted_terms_at, created_at   UNIQUE(provider, provider_uid)
sessions   token_hash, user_id, expires_at                                                    -- hashed, 30-day sliding
logins     login_id, token_hash, expires_at                                                   -- desktop handoff, single use
presets    id, user_id, title, description, device(DeviceKey), tags(json), guitar, notes,
           r2_key, sha256, size, likes, downloads, status('visible'|'hidden'|'removed'), created_at
likes      user_id, preset_id                                                                 UNIQUE
reports    id, preset_id, user_id, reason, created_at                                         UNIQUE(user_id, preset_id)
```
Search = `LIKE` on title/description/tags plus filters on `device`, ordered by newest/likes/downloads. (ponytail: no FTS until it measurably hurts.) Pagination by keyset on `(created_at, id)`.

## API (all JSON, `/api`)
| Method + path | Auth | Purpose |
|---|---|---|
| `GET /presets?device=&tag=&q=&sort=&cursor=` | optional | list (hides `status != visible`); includes `liked` when signed in |
| `GET /presets/:id` | optional | detail |
| `GET /presets/:id/file` | none | `.prst` bytes from R2, increments `downloads` |
| `POST /presets` | yes | multipart: `.prst` + metadata; validates, stores R2 + D1 |
| `DELETE /presets/:id` | owner/admin | remove |
| `PUT/DELETE /presets/:id/like` | yes | like / unlike (idempotent) |
| `POST /presets/:id/report` | yes | report; auto-hide at N distinct reports |
| `GET /me`, `POST /auth/logout` | yes | session info / sign-out |
| `GET /auth/:provider/start`, `/auth/:provider/callback`, `GET /auth/poll` | none | SSO + desktop handoff |

### Server-side `.prst` validation (trust boundary, not optional)
Reuse `gp5/lib/prst.mjs` and the GP-200 codec: exact length per device family (GP-5 507 B, GP-200 family 1224 B, GP-50 per its codec), CRC/header check, parse succeeds, sniffed device equals declared `device`. Hard size cap (e.g. 4 KB) checked before reading the body. Reject everything else. Store `sha256` and reject duplicates per user. Never forward unvalidated bytes to a pedal; the client re-validates before import too.

## SSO
- **Google**: OIDC authorization code + PKCE, scope `openid profile`. Identity = `sub`.
- **GitHub**: OAuth App code flow, scope empty (public profile only, no email). Identity = numeric `id`.
- Common: `state` stored in a short-lived HttpOnly cookie and checked on callback; redirect URIs are fixed per provider (exact match); no email is collected or required; sessions are random 256-bit tokens, only the hash is stored.
- Accounts are **per provider** in MVP (same person via Google and GitHub = two accounts). Linking is a later feature.
- Secrets (`*_CLIENT_ID/SECRET`) as Worker secrets via `wrangler secret put`; nothing in the repo or in `.env` committed.

## Phases and tasks
**Phase 0, groundwork** (S)
1. Verify `prst.mjs` / GP-200 / GP-50 codecs are isomorphic (no Node-only imports) so the Worker can import them; if not, extract the pure part.
2. Decide domain/origin and licence text (open questions below).

**Phase 1, backend skeleton** (M)
3. `app/worker/` + `wrangler.jsonc` (assets + `main`, D1 and R2 bindings), migrations in `app/worker/migrations/`.
4. Router, JSON helpers, error mapping, rate limit on writes (Cloudflare rate-limiting binding or per-user counter in D1).
5. Presets: list/detail/file/create/delete with validation. Tests: validation accept/reject matrix (real fixtures from the repo), pagination, ownership checks.

**Phase 2, auth** (M-L)
6. Provider modules (`google.ts`, `github.ts`) behind one small interface `{ authorizeUrl, exchange -> {uid, name, avatar} }`.
7. Sessions (cookie for web, bearer for desktop), `state` + PKCE, desktop `login_id` handoff and poll. Tests: state mismatch, expired/replayed login, cookie flags, session hashing.
8. Register the two OAuth apps (Google Cloud console, GitHub OAuth App; needs the final origin).

**Phase 3, host API + web client** (M)
9. `src/shared/host/community.ts` (types + `CommunityApi`), add to `HostApi`.
10. `host/web/community.ts` (fetch with cookie). Include an in-memory mock behind `?mock` so the screen is demoable/testable offline, like the existing device mocks.
11. Electron: `main/ipc/community.ts`, `preload/community.ts`, token in `safeStorage`, system-browser sign-in flow. Update `preload/index.d.ts`.

**Phase 4, Community screen** (L)
12. `screens/community/`: `CommunityScreen.tsx`, `store.ts`, `PresetCard`, `PresetSheet` (detail), `PublishDialog`, `SignInDialog`, `ReportDialog`.
13. Actions: "Import to Library" (reuse Library import path), "Write to slot" (existing write flow with its confirmation gates), like, report, publish from a Library slot or a `.prst` file.
14. Nav: `Screen` union, `Rail` item, `?screen=community`, command palette entry. Update What's New only at release time.
15. Tests: store (list/filter/paging/like optimistic rollback), import path, publish validation messages, nav.

**Phase 5, moderation, legal, ops** (M)
16. Admin: `role='admin'` can hide/remove; MVP admin UI is none, use `wrangler d1 execute` plus a hidden-queue query documented locally. Auto-hide at N reports.
17. Terms/Content policy + licence shown in the publish dialog (checkbox required), takedown contact, "report" wording. Stored `accepted_terms_at` on `users`.
18. CI: typecheck/test the Worker; `deploy:web` also applies D1 migrations; staging Worker for OAuth testing.

## Files to change (high level)
| File | Action |
|---|---|
| `app/worker/**`, `app/wrangler.jsonc`, `app/tsconfig.worker.json` | CREATE / UPDATE |
| `app/src/shared/host/community.ts`, `host.ts` | CREATE / UPDATE |
| `app/src/renderer/src/host/web/community.ts`, `host/web/index.ts` | CREATE / UPDATE |
| `app/src/main/ipc/community.ts`, `app/src/preload/community.ts`, `preload/index.ts`, `index.d.ts`, main CSP | CREATE / UPDATE |
| `app/src/renderer/src/screens/community/**` | CREATE |
| `state/nav.ts`, `app/Rail.tsx`, `app/commands.ts`, `app/App.tsx` (screen switch) | UPDATE |
| `app/package.json` (scripts for D1 migrate/dev), `README.md` | UPDATE |

## Validation
```bash
cd app && npm run typecheck && npm test
npx wrangler dev          # local D1/R2, curl the API, run each OAuth provider against localhost app registrations
npm run web               # ?screen=community&mock demo
```

## Risks
| Risk | Level | Mitigation |
|---|---|---|
| Spam/abuse and offensive content | High | login required, per-user rate limit, report + auto-hide, admin removal, terms checkbox |
| Copyright claims (artist-named presets) | Medium | terms + takedown contact + fast removal path; presets are parameter sets, not audio |
| Malformed/malicious `.prst` reaching pedals | High | strict server validation + client re-validation + existing write confirmation gates |
| Desktop sign-in UX (system browser handoff) | Medium | single-use short-TTL `login_id`, clear "return to app" page, cancel/timeout in UI |
| Third-party avatars vs COEP `credentialless` | Low | avatars load without credentials; if blocked, proxy or drop avatars (initials fallback) |
| Cloudflare costs at scale | Low | free tier covers MVP; keyset pagination, cache list responses briefly |
| Account fragmentation per provider | Low | accepted for MVP; linking later |
| Scope creep (comments, profiles, IR) | Medium | explicitly out of MVP |

## Open questions (need an answer before Phase 2)
1. Production domain/origin (OAuth redirect URIs depend on it): `*.workers.dev` for now, custom domain later?
2. Content licence for uploads: CC0, CC BY 4.0, or "personal use only"?
3. Should the Electron app's Community tab work signed-out (browse/download without login)? Plan assumes yes: only publish/like/report need login.
4. Presets only in MVP, or also whole-bank bundles (multiple `.prst`)? Plan assumes single presets.

## Acceptance
- [ ] Browse/search/filter/download works signed-out on web and desktop
- [ ] Sign in with Google and GitHub works on web and desktop
- [ ] Publish validates server-side and rejects bad files with a clear message
- [ ] Like, report, delete-own, admin removal work
- [ ] Typecheck and tests pass; Worker covered by validation/auth tests
