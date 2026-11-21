# JJ Furniture OMS — Hybrid Order Coordination System

Mobile-first order monitoring for **JJ Furniture Shop and Enterprises** (Poblacion, Valencia City, Bukidnon). Handwritten paper slips stay at the counter. A zero-install phone-browser app gives the owner, store assistants, craftsmen, drivers and customers **one shared live order record** (HCI Design Phase II, Concept 3).

| Portal | Route | Persona | What it does |
|---|---|---|---|
| Owner `O-01` | `/owner` | Mr. Vincris Lelis | 8 live KPIs, *Needs Your Attention* (approve/reject exceptions, pass/fail inspection, answer spec questions, retry SMS, rank new jobs), production priority queue |
| Store Assistant `S-01` | `/staff` | Gilbert Decena, Liza | New Order from paper slip, Today's Work queues, order detail, printable QR confirmation slip |
| Craftsmen `C-01` | `/craftsman` | Nolito Remulta, Carlo, Dodong | Priority-sorted job cards (To Do / In Progress / For Revision / Done). **No financial data is fetched.** |
| Delivery Driver `D-01` | `/driver` | Jesse Decena, Rey | Assigned trips only, COLLECT ON DELIVERY, works offline (IndexedDB queue + sync) |
| Customer `CU-01` | `/track` | public | Order ID → stage and dates only. Order ID + 4-digit PIN → specs, payments, Confirm Specifications, Request Touch-Up |

## Video demonstration

* **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)**: the click-by-click presentation script (≈ 7:45) with narration cues, sample data and troubleshooting.
* `/about`: the introduction page used for the opening segment.
* `tests/e2e/demo-walkthrough.mjs`: performs the whole script in a real browser at 1280×720 or 390×844, fails on any broken step, and records a rehearsal video.
* All sample people are fictional; phone numbers use the `0900-000-xxxx` pattern. In demo mode SMS is **simulated** and labelled as such.

## Quick start (demo mode, no accounts needed)

```bash
npm install
cp .env.example .env.local      # NEXT_PUBLIC_APP_MODE=demo, Supabase left empty
npm run dev                      # http://localhost:3000
```

With no Supabase credentials, demo mode runs on an **in-memory database** seeded with Valencia City / Bukidnon sample orders (`JJ-2026-0145`, `DR-0148`, `JJ-2026-0136`, `JJ-2026-0133`, …). The top bar switches roles, toggles **Design Notes** (HCI rationale callouts) and **Reset Demo Data**. The in-memory store lives in one server process. For a hosted demo, point demo mode at a Supabase demo project instead.

## Modes and security model

| | `NEXT_PUBLIC_APP_MODE=demo` | `NEXT_PUBLIC_APP_MODE=production` |
|---|---|---|
| Role switcher / Design Notes / Reset | shown | **not rendered**. Server actions refuse role switching |
| Staff identity | signed, http-only demo cookie issued by the server | Supabase Auth session; role read from `profiles` on the server |
| Data access | in-memory store, or Supabase service role (demo projects only) | Supabase with the **user's JWT**, so every read is filtered by RLS |

* **Zero frontend trust.** Every page and server action resolves the actor on the server (`src/lib/server/context.ts`). Services re-check the role (`ensureRole`). Postgres RLS and triggers enforce the same rules a third time.
* **RLS** (`supabase/migrations/001_init.sql`) covers every table. Craftsmen have no policy on `orders`. They read `workshop_orders`, a view with no money or contact columns. Drivers see only orders linked to their `delivery_assignments`. Drivers cannot self-verify cash. Owner-only decisions (inspection, priority, payment-exception approval) are enforced by triggers.
* **Customers** call two `SECURITY DEFINER` RPCs. `customer_track(code)` returns stage and dates only. `customer_verify_pin(code, pin, client_key)` checks the bcrypt hash and locks out after 5 failures in 15 minutes per client. A correct PIN issues an HMAC-signed, http-only cookie scoped to **that one order** for one hour.
* `SUPABASE_SERVICE_ROLE_KEY` is imported only by `server-only` modules. It is used through `store.elevated()` for narrow, already-authorized operations: the customer view after PIN verification, craftsman status changes, and notification logs.
* PINs are stored as bcrypt hashes. The `$2a$` prefix keeps them compatible with pgcrypto `crypt()`. The PIN hash never reaches a browser.

## Business rules (enforced in TypeScript *and* Postgres)

* **7 stages:** Waiting for Confirmation → Confirmed → In Production → Completed / For Inspection → Ready for Delivery → Out for Delivery → Delivered. The allowed backward moves are re-confirmation, a failed inspection (back to In Production, shown as *For Revision*), and a failed delivery (back to Ready for Delivery).
* **Hard gate:** an order cannot be Confirmed or In Production until `specs_confirmed` is true. This is a CHECK constraint plus a trigger. Each confirmation stores an immutable JSONB spec snapshot.
* **30/70 engine:** down payment due = 30% of price. Remaining balance = price − *verified* furniture payments. Valencia City delivery fee is forced to ₱0. Collectible on delivery = remaining balance + unpaid delivery fee. Driver cash stays unverified until staff count it at handover.
* **Exception gate:** Installment / Credit terms automatically queue an owner approval. Dispatch with less than 30% paid is blocked unless the owner approves. A short collection on delivery raises an approval automatically.
* **Structured specs + revisions (migration 003):** every order stores `furniture_category`, `design_variant`, `width_cm`/`height_cm`/`depth_cm` (0 < x ≤ 1000), wood (Mahogany / Gmelina / Other + required note) and finish as authoritative columns. Every change is an immutable row in `order_specification_revisions` (`UNIQUE(order_id, revision_number)`, written under `SELECT … FOR UPDATE` with an optimistic `expected_revision` check). `spec_preview_config` is presentation-only.
* **Customer scenarios:** while Waiting for Confirmation the customer can (1) **confirm the latest shop quote** (the confirmation row links `revision_id`/`revision_number` and the server sets `approved_revision_number`) or (2) **submit specification changes for review** (a `customer_proposal` revision plus a *Pending Spec Clarification* item containing the exact diff, e.g. `Wood: Gmelina -> Mahogany; Width: 180cm -> 220cm`); staff answer with a `revised_quote` revision that the customer must confirm. After production starts the spec is read-only ("Locked — Confirmed for Workshop Production") and only **Request Post-Confirmation Change / Repair** is offered.
* **Production gate (server-side, six conditions; trigger in Postgres, mirrored in TypeScript):** moving to Confirmed / In Production requires (1) `specs_confirmed`, (2) `approved_revision_number` equal to `current_revision`, (3) the approved revision is a shop quote, not a customer proposal, (4) no pending review items for the order, (5) a valid preceding status, and (6) the order's structured spec, price and fee still equal the approved revision. Legacy orders with incomplete dimensions cannot be confirmed at all.
* **Legacy orders:** orders created before 003 keep their free-text `dimensions`; W/H/D stay NULL with `is_legacy_incomplete = true` (shown as *Dimensions Pending Clarification*) until staff issue a revised quote with exact centimetres. No dimensions are guessed.
* **Codes:** new orders get `DR-####` and are promoted to `JJ-YYYY-####` on confirmation, keeping the same sequence number.

## Offline driver sync

`src/lib/offline/driver-db.ts` keeps `manifest`, `sync_queue` and `meta` stores in IndexedDB, one database per driver.

1. Assignments are cached automatically on every page load. **Pre-Load Assignments for Offline Travel** refreshes them on demand. A service worker (`public/sw.js`) lets `/driver` reopen with no signal.
2. Actions are always written to the local queue first, each with a `client_transaction_id` and the order `version` it was based on. Queued actions are labelled **"Saved Locally — Pending Sync"**.
3. The badge reads `Online • Synced`, `Offline • Saved Locally (N pending)`, `Syncing...` or `Sync Conflict`, with the last successful sync time. **Simulate Offline / Weak Signal** blocks all network calls, so the queue can be tested honestly.
4. The queue flushes on the `online` event or **Sync Now**, sequentially, through `/api/driver/sync`. The server is idempotent on `client_transaction_id` (unique in `payments` and `order_status_history`). A version mismatch returns a conflict for the driver to **Re-apply** or **Discard**; nothing is silently overwritten. The driver's own consecutive actions are rebased automatically.

## Live Supabase project

* Project **`jj-furniture-oms`** (ref `ctjdasbwgchlfjzqeqel`, region Singapore `ap-southeast-1`, org *JJs Furniture Org*, Free plan): `https://ctjdasbwgchlfjzqeqel.supabase.co`
* Migrations applied: `001_init`, `002_security_hardening`. Demo data is loaded: 8 staff, 14 orders, payments, history, deliveries, approvals and notifications. Balances computed by the database match the app engine for all 14 orders.
* Verified on the live database: every role sees only its rows; the public cannot call the customer functions or read tables; PIN hashes made by the app verify in Supabase; staff sign-in and a real staff write work end to end through RLS.
* Demo staff Auth users (`vincris.lelis@jjfurniture.test`, `gilbert.decena@…`, `liza@…`, `nolito.remulta@…`, `carlo@…`, `dodong@…`, `jesse.decena@…`, `rey@…`) have **random, unknown passwords**. Set one in Supabase → Authentication → Users before signing in, or run `npm run db:seed` with the service role key.
* Still needed from the dashboard (Settings → API): **`SUPABASE_SERVICE_ROLE_KEY`**. Without it, the customer portal, craftsman status changes, and demo mode on Supabase cannot run.
* Behind an outbound proxy, start Node with `NODE_USE_ENV_PROXY=1` so server-side calls to Supabase use the proxy.

## Supabase setup

1. Create a project. In **SQL Editor**, run `supabase/migrations/001_init.sql`, or use `supabase db push` with the Supabase CLI.
2. Create staff users and profiles. For a **demo** project, seed everything:
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SEED_STAFF_PASSWORD='a-long-password' npm run db:seed -- --reset
   ```
   For production, create each staff user in **Authentication → Users**, then insert a `profiles` row (`id` = auth user id, `full_name`, `role`).
3. Set the environment variables listed in `.env.example`.

## Deploy (GitHub → Supabase → Vercel)

1. Push this repository to GitHub.
2. Vercel → *New Project* → import the repo. The framework is detected as Next.js.
3. Add the environment variables in Vercel → Settings → Environment Variables: `NEXT_PUBLIC_APP_MODE=production`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `JJ_SESSION_SECRET` (`openssl rand -hex 32`), `NEXT_PUBLIC_SITE_URL`, and optionally `SEMAPHORE_API_KEY`.
4. Deploy. Use a separate Vercel project or preview environment with `NEXT_PUBLIC_APP_MODE=demo` and a demo Supabase project for usability testing.

## Testing

```bash
npm test           # Vitest: 34 unit tests (validation, 7-stage machine, 30/70 finance, privacy, IndexedDB offline sync, idempotency, conflicts)
npm run test:db    # Postgres: 37 assertions on the real migration (triggers, constraints, RLS per role, PIN rate limit) + seed cross-check
npm run build && PORT=3100 npm start &
BASE_URL=http://localhost:3100 npm run test:e2e   # Playwright: all 5 portals end-to-end, mobile no-horizontal-scroll, dark mode
```

`test:db` needs a local Postgres. Set `PGURL=postgres://user:pass@host:5432`. It runs the migration unchanged on top of `supabase/tests/00_supabase_stub.sql`, which emulates Supabase's `auth.uid()` and API roles.

## Design system and Figma handoff

* All colors are semantic CSS variables in `src/app/globals.css`: `--background`, `--foreground`, `--card`, `--primary`, `--border`, `--success`, `--warning`, `--info`, and others. They come in two modes. **Normal (light)** is the high-contrast mode for workshop and sunlight; **Dark** uses the `#14100D` / `#1E1814` warm-walnut surfaces. The palette is a wooden minimalist set: cream `#FAF7F2` background, walnut `#6F4229` primary, brass `#B8864B` accent (decorative only; `--accent-soft` is used behind text for contrast). Type is Plus Jakarta Sans with tabular numerals for ₱ and cm.
* `npm run tokens` exports them to `design/tokens.json` (Tokens Studio / Figma Variables format, both modes). Import that file into Figma so the design and the code use the same token names.
* **Figma file:** [JJ Furniture OMS — Design System & Portals](https://www.figma.com/design/9vS0YZSE2kE4a34plawO3P). It contains the variable collections `JJ OMS / Color · Normal (Light)`, `JJ OMS / Color · Dark` (44 tokens each, with `var(--…)` code syntax) and `JJ OMS / Shape`. Light and Dark are separate collections because the Figma Starter plan allows only one mode per collection; on a paid plan they can be merged into one two-mode collection. The *Portals (mobile 390)* page holds 8 screens captured from the running app.
* To re-sync screens after UI changes: start the app on port 3100, run `node scripts/figma/capture-portals.mjs && node scripts/figma/mobilize.mjs`, then import `design/portals.html` with Figma's HTML import (`.screen-wrap` selector).
* UI is built from `shadcn/ui` (Base UI) and `lucide-react`. Touch targets are ≥ 44 px, and primary actions are 56 px.

## Scope boundaries (by design)

No inventory or raw-material tracking. No native app wrapper. No OCR or Messenger scraping: staff transcribe slips. No customer accounts: customers use Order ID + PIN only.

## Project layout

```
supabase/migrations/001_init.sql   schema, triggers, RLS, customer RPCs
supabase/tests/                    Supabase stub + SQL assertions
src/lib/domain/                    types, state machine, finance engine, validation (shared)
src/lib/data/                      DataStore contract, MemoryStore (demo/tests), SupabaseStore, seed data
src/lib/services/                  business workflows (orders, payments, deliveries, exceptions, customer, insights)
src/lib/offline/driver-db.ts       IndexedDB manifest + sync queue
src/lib/server/                    actor resolution, Supabase clients, signed tokens
src/app/                           portals, server actions, driver API routes
tests/unit, tests/e2e              Vitest + Playwright
```
