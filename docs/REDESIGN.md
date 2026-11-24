# JJ Enterprises redesign — what was built

Branch `feature/jj-enterprises-redesign`, from the *JJ Enterprises: HCI System Requirements & UI/UX Specification*. The existing colour palette was kept unchanged throughout.

## Phase by phase

| Phase | Spec items | Where |
|---|---|---|
| 1 · Brand & design system | Name *JJ Enterprises — Furniture and Lumber Dealer*; logo with the green background removed; Plus Jakarta Sans (no Inter); Lucide icons; flat hairline rows instead of cards; sentence-case labels; phone bottom navigation with a raised **+** | `public/brand/`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/rows.tsx`, `src/components/mobile-nav.tsx` |
| 2 · Landing + accounts | Landing page (sample work, about us, Login / Demo button, no testimonials); six demo accounts — **Demo** (role switcher), Owner, Staff, Craftsman, Rider, Customer; one sign-in page | `src/app/page.tsx`, `src/app/login/`, `src/lib/data/seed.ts` (`demoAccounts`) |
| 3 · Order flow | One JJ-YYYY-#### Order ID from submission and a printable order slip; **Confirm order** → create-password email; **Issue quotation** → "choose how to pay" email; customer accepts with **30% / installment / full** and **cash / GCash-Maya / bank transfer**; online and bank payments with **reference no. + receipt**, verified or rejected by staff; 30% gate before production | migration `009a` + `009b`, `src/lib/services/{orders,customer,customer-portal,payments}.ts`, `src/app/customer/orders/[code]/quote-and-pay.tsx`, `src/app/customer/customize/order-slip.tsx` |
| 4 · Designer | 3D view sticky on desktop and pinned on phones; **customization assistant** (rule-based parser, English and Filipino words, any common unit, photo library match); **Spec locked** from In Production | `src/components/orders/FurnitureConfigurator.tsx`, `src/lib/domain/assistant.ts`, `src/components/orders/customization-assistant.tsx` |
| 5 · Owner, inventory, rider | Owner sidebar (Dashboard, Orders & Quotations, Staff, Craftsmen, Deliveries, Lumber & Inventory, Reports, Roles & Access) with KPIs and assignment; Lumber & Inventory with board feet, reorder levels, receive / use / adjust, low-stock alerts; rider rows with *On process / In transit / Delivered* pills and a detail view | migration `010`, `src/app/owner/*`, `src/lib/services/inventory.ts`, `src/app/driver/driver-app.tsx` |
| 6 · Verification | Tests for every account on desktop and phone, the password flow, payments, the lock, and the Demo Inbox emails; docs | `tests/`, `supabase/tests/12_*.sql`, `supabase/tests/13_*.sql`, this file |

## Choices made with the owner

* New order flow from the spec; one Order ID from submission (no draft codes).
* Online and bank payments need a reference number and a receipt; staff verify them.
* The assistant is a smart parser plus the shop's photo library (no AI service; nothing leaves the browser).
* Simple lumber stock tracking in board feet.
* Demo Mode uses fixed demo accounts; the live site uses real Supabase accounts.
* Emails are checked in the Demo Inbox and by automated tests.

## Security notes

* An order is linked to a customer account only by `claim_customer_orders()`, for a **signed-in** customer (a password can only be set through a link sent to that inbox), and only for orders the **shop confirmed** whose confirmation email went to that account's address. Legacy orders, unconfirmed submissions and orders whose email changed later are never auto-linked.
* The "choose how to pay" email carries no secret; the order page needs the customer's login.
* Payment receipts live in a private storage bucket and are streamed to staff/owner only; the file type is checked by its bytes.
* Payments, acceptances and lumber movements are append-only. Stock on hand and order balances are computed by database triggers, never typed in.
* Craftsmen never see prices or phone numbers, and see a confirmed order only after its quotation is accepted.

## Not applied, not done

* **Migrations 009 and 010 are not applied to the live Supabase project.** They are tested locally (`npm run test:db`, including twice on a copy of the live data). Applying them needs the owner's explicit go-ahead.
* For the live site, set `SHOP_GCASH_DETAILS` and `SHOP_BANK_DETAILS` (shown to customers on the payment form). Without them customers are told to ask the shop for the account details.
* The oval dining set and sala set photos are still to come; the landing page and the assistant show labelled 3D previews in their place.
* Roles & Access is read-only: accounts are created and disabled in Supabase Auth.
* Staff are allowed (by the database and services) to record lumber movements, but the inventory screen is in the owner portal only.

## Test totals at the end of Phase 6

| Suite | Result |
|---|---|
| `npm test` (Vitest) | 243 passed |
| `npm run test:db` (Postgres, real migrations) | 307 assertions passed |
| `npm run test:e2e` (fixtures dataset) | 13 / 13 steps |
| `npm run test:e2e:curated` (curated dataset) | 11 / 11 steps, including all six accounts at 1440 px and 390 px |
| `tests/e2e/demo-walkthrough.mjs` | passed at 1280 × 720 and 390 × 844 |
| `tsc --noEmit`, `eslint` | 0 errors |
