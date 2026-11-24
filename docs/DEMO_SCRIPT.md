# JJ Furniture OMS — Video Demonstration Script (≈ 7:45)

Follows the presentation sequence in Section 11.B. Every step uses the built-in demo
data and real application features. Nothing is faked except where it says
**simulated** on screen (SMS, because no SMS gateway is connected in demo mode).

## Before you record

1. Get the latest version and start the app (PowerShell, inside `jj-furniture-oms`):
   ```bash
   git pull
   ```
   ```bash
   npm install
   ```
   ```bash
   npm run dev
   ```
   Do **not** create a `.env.local` file. Without it the app runs in Demo Mode on built-in sample data.
2. Open **http://localhost:3000** in Chrome or Edge. Set the window to about **1280 × 720** and the browser zoom to **100%**.
3. Click **Reset Demo Data** in the dark top bar and confirm. Do this before **every take**.
4. Start your screen recorder (Windows: **Win + G** → Capture, or OBS Studio).
5. Optional rehearsal: watch `demo-walkthrough-desktop.mp4`, which shows the same flow performed automatically.

> Privacy: every name, address and phone number is fictional. Phone numbers use the `0900-000-xxxx` pattern. No passwords or API keys appear anywhere in Demo Mode.

## Sample data you will use

> **Which demo data?** The default Demo Mode now opens with the **five curated orders** (JJ-2026-1001 … 1005, see the README's *Demo data*). This step-by-step presentation uses the larger regression dataset: start the app with `DEMO_DATASET=fixtures npm run dev` to follow it exactly.

| Order | Customer (fictional) | Where it appears |
|---|---|---|
| **JJ-2026-0149** *(you create it in step 2)* | Rosalinda Abellana | Every portal, full 7-stage lifecycle |
| JJ-2026-0145 | Maria Santos | Urgent dining table, In Production |
| DR-0148 | Ramon dela Cruz (ramon.delacruz@example.com) | Confirmed, quotation issued — a resent review link is in the Demo Inbox |
| DR-0147 | Josefina Lagura | Quote Requested — an older online request (before migration 009) |
| Customer login | **Demo Customer Login (Maria Santos)** button, or maria.santos@example.com / JJ-Demo-2026 | Dashboard with JJ-2026-0145 |
| JJ-2026-0136 | Pedro & Ana Bautista | Out for Delivery (driver Jesse) |
| JJ-2026-0133 | Lourdes Ybañez | Delivered, unpaid balance (approved credit); legacy order, no email, not linked to any account |

New orders get the next number. After a reset, the first new order is **JJ-2026-0149**: the Order ID is permanent from the moment it is saved.

---

## 1. Introduction — 0:45

**Click:** top bar → **About**.

**Say:** "JJ Furniture Shop and Enterprises in Poblacion, Valencia City, builds custom Mahogany and Gmelina furniture. In our Discover phase we found orders spread across paper slips, notebooks and Messenger, priorities given verbally, and delivery problems on provincial routes with weak signal."

Scroll to **What we found in the Discover phase**, then **One record, five portals**, then **The 7-stage order lifecycle**.

**Say:** "Our Hybrid Order Monitoring System keeps the paper slip at the counter, and gives every role one shared live record in an ordinary phone browser. There's nothing to install and no monthly software cost."

## 2. Staff Portal (S-01) — 1:30

1. Top bar → **Staff**. Show **Operations & Order Queue**: four live metrics, stage filters with counts, one calm 5-column table. Click any row: the order opens in a slide-over drawer with *Overview & 3D Spec*, *Quotation & Revisions* and *Payments & Gate* tabs.
2. Click **+ New Order** and fill in the form:

   | Field | Value |
   |---|---|
   | Paper Slip # | **0149** |
   | Encoded by | Gilbert Decena (already selected) |
   | Customer name | Rosalinda Abellana |
   | Mobile number | 0900 000 0149 |
   | Customer email | rosalinda.abellana@example.com (or tick **Walk-In / No Email** for a paper-slip-only customer) |
   | Municipality | **Lantapan** |
   | Delivery fee | **800** |
   | Delivery address | Purok 3, Brgy. Poblacion, beside the chapel |
   | Furniture category (configurator) | **Dining Table** |
   | Design | 6-Seater Classic |
   | Size preset | **180 × 76 × 90 cm** (W × H × D) |
   | Wood | Tap **Gmelina**, then **Mahogany** |
   | Color / finish | Tap **Gloss White**, **Dark Espresso**, then **Walnut Stain** |
   | Furniture price | **24000** |

   **Say:** "The configurator stores exact centimetres in structured columns. The preview beside it, with a 165 cm person for scale, updates as I tap. It is labelled as an illustrative reference only, not a manufacturing drawing."

3. Point at the **Price & payment** box: 30% down payment **₱7,200**, 70% balance **₱16,800**, delivery fee **₱800**, collect on delivery **₱17,600**.
4. Change **Municipality** to **Valencia City**. The fee becomes **FREE** and the amount to collect becomes **₱16,800**.
   **Say:** "Delivery inside Valencia City is free; provincial deliveries add a distance fee."
5. Click **Save order**. The **printable confirmation slip** opens. Show:
   - **Order ID** JJ-2026-0149, **Paper Slip #**, and *Customer updates: rosalinda.abellana@example.com* (no PIN).
   - The **QR code**.
   - **Estimated completion** and **Scheduled delivery**, shown as two separate dates.
   - The **payment breakdown**.

   Optional: click **Print** to show the print layout, then cancel.

## 3. Confirm → quotation → customer accepts and pays — 1:45

**Staff: confirm, then issue the quotation (about 30 seconds)**
1. Back on the order (**Back to order**): the **Next step** box says *New order — check the design, then confirm it*. Click **Confirm order** → OK.
   **Say:** "Confirming needs no price yet. The customer is emailed a link to create their password."
2. **Issue quotation** → check the configurator → **Issue quotation**. The order stays *Confirmed*; the customer is emailed to accept it and choose how to pay.

**Customer (about 60 seconds)**
3. Top bar → **Demo Inbox**. Open the email to **rosalinda.abellana@example.com** titled *Order JJ-2026-0149 confirmed — create your JJ Enterprises password* → **Open secure link** → type a password twice → **Save password**. She lands on **My orders**.
   **Say:** "No PIN to lose and no password ever emailed. Signing in proves the inbox is hers, so her confirmed order appears."
4. Open **JJ-2026-0149** → **Accept your quotation**: choose **30% down payment**, **Installment** or **Full payment**, and **Cash**, **GCash / Maya** or **Bank transfer**; tick both boxes → **Accept quotation**.
5. **Payments**: GCash is pre-selected with the shop's (demo) number and the 30% amount. Enter a reference number, add a receipt photo → **Send payment for checking**. It shows *Being checked*.
   **Say:** "A submitted payment never counts until the shop verifies it."
6. Optional: log out, then **Demo Customer Login (Maria Santos)** (Demo Mode only) to show her dashboard; open JJ-2026-0145 → **Request Post-Confirmation Change / Repair**.

**Staff: verify → release to the workshop (about 20 seconds)**
7. Top bar → **Staff** → JJ-2026-0149 → **Payments & Gate**: **Open receipt**, then **Verify** → OK.
8. **Release to workshop** → the dialog shows *30% verified ✓* → **Start production**.
   **Say:** "The server re-checks the verified 30%, the accepted latest quotation, price drift and open spec questions before the specification locks."

**Optional — an online order (about 40 seconds)**
* Home → **Design your piece**. Pick a design, size, wood and finish, fill name / email / mobile / address → **Submit order**. The **order slip** appears at once with the permanent Order ID and *waiting for confirmation*; **Print or save slip** prints only the slip. It appears under **Staff → To confirm**.

## 4. Craftsmen Portal (C-01) and Owner Dashboard (O-01) — 2:00

**Craftsmen**
1. Top bar → **Craftsmen** (Nolito Remulta). **Say:** "One row per job, sorted by the owner's priority. No prices or customer phone numbers are ever sent to this screen."
2. **Up Next** tab: jobs whose quotation was accepted show *"do not cut wood yet"*. **Say:** "Craftsmen never see a quotation that can still change, and cannot start production themselves; the office releases jobs after the 30% is verified."
3. **In Progress** tab (JJ-2026-0149) → **Ask Spec Question** → type *"Should the table edge be rounded or square?"* → **Send question**. The job moves to **For Revision** because a question is open.
4. **For Revision** tab → **Mark Ready for Owner Inspection** → tick the 4 checklist boxes → **Send to owner**.

**Owner**
5. Top bar → **Owner**. The **sidebar** lists Dashboard, Orders & Quotations, Staff, Craftsmen, Deliveries, Lumber & Inventory, Reports and Roles & Access, with live counts. On the **Dashboard**, walk through the 8 KPIs (to confirm, quotation & payment, workshop, delivery, deposits, balances, delayed, low lumber stock).
6. Sidebar → **Orders & Quotations** → open JJ-2026-0149 → answer the craftsman's spec question: **Answer** → *"Rounded edges, 1cm radius — confirmed with the customer."* → **Send answer to workshop**.
7. Sidebar → **Dashboard** → **Awaiting your decision**: **JJ-2026-0140 Installment Approval** → **Approve** → **Approve**.
8. Sidebar → **Craftsmen**: workload per craftsman, the **Assign jobs** picker, and **Production priority** — on JJ-2026-0149 click **Urgent**. It jumps to #1, and the craftsmen see the same order.
9. Sidebar → **Lumber & Inventory**: board feet on hand with the reorder tick; Gmelina and Acacia are flagged *Low · reorder*. Optionally **Receive** on Acacia: 10 pieces × 2 × 4 × 10 ft shows **= 66.67 board feet** → **Add to stock**. **Say:** "Stock changes only through these entries, and it can never go below zero."
10. Sidebar → **Dashboard** → **Quality inspection · JJ-2026-0149** → **Pass** → **Passed — ready for delivery**. It's now stage 5/7, Ready for Delivery.

**Staff hand-off (about 20 seconds, needed before the driver can leave)**
11. Top bar → **Staff**:
   - **Schedule driver & vehicle** → JJ-2026-0149 → **Schedule delivery** → Driver **Jesse Decena**, Vehicle **Multicab**, Date **today**, Time **1:00 PM - 3:00 PM** → **Schedule delivery**.

   **Say:** "The 30% was verified before production, so dispatch is allowed."

## 5. Delivery Rider Portal (D-01) — 1:30

1. Top bar → **Delivery Rider** (Jesse Decena). The badge shows **Online • Synced**. Each trip is one row with a status pill (**On process**, **In transit**, **Delivered**) and the cash to collect. Tap the JJ-2026-0149 row to open the stop: address, **Call**, **Map**, and **Collect on delivery ₱16,800**.
2. Click **Pre-Load Assignments for Offline Travel**. **Say:** "Before leaving the shop, his trips are saved on the phone."
3. Turn on **Simulate Offline / Weak Signal**.
4. On JJ-2026-0149: **Start Trip**, then **Mark Delivered & Log Cash Collected** (₱16,800 pre-filled) → **Save on phone**.
5. Show the badge **Offline • Saved Locally (2 pending)** and the yellow rows **"Saved Locally — Pending Sync"**.
   **Say:** "It never pretends the data reached the shop."
6. Turn **Simulate Offline** off. It syncs automatically: **Online • Synced**, a new **Last successful sync** time, and, after **All deliveries**, the trip is under **Done** with a **Delivered** pill.

## 6. Final Overview — 1:00

1. Top bar → **Staff** → **Verify driver cash handover** → **Verify ₱16,800** (JJ-2026-0149) → OK.
2. **All Orders** tab → open **JJ-2026-0149**. The stage tracker shows all **7 stages complete**:
   Waiting for Confirmation → Confirmed → In Production → Completed / For Inspection → Ready for Delivery → Out for Delivery → Delivered.
3. Scroll to **Status history** (the full audit trail, including actions synced from the driver's phone) and **Customer updates**. SMS statuses are marked *simulated* in demo mode.
4. Top bar → **Customer** → **JJ-2026-0149** → **Check status only**. The customer sees **Delivered** without calling the shop.
5. Top bar → **Owner**. The KPIs have updated.
   **Say:** "One shared record replaced paper rework, repeated customer follow-ups and forgotten deliveries, using browsers the shop already has and no recurring software cost."

---

## Between takes / troubleshooting

* Always click **Reset Demo Data** before a new take. It restores all 14 sample orders and the next new order is again JJ-2026-0149.
* **"Paper slip #0149 is already encoded"**: you didn't reset after the last take. Reset and start again.
* **Driver doesn't see JJ-2026-0149**: the staff hand-off in step 4.9 was skipped (down payment + schedule for **today**).
* **Phone instead of laptop:** the same flow works at 390 × 844. Open `http://<your-PC-IP>:3000` on the same Wi-Fi.
* **Design Notes** (top bar) shows the HCI rationale callouts if you want them on screen.

Automated check of this exact script (developer tool; also records a rehearsal video). It needs Playwright on
the computer (`npm i -D playwright` then `npx playwright install chromium`). In PowerShell, with `npm run dev` running:

```bash
$env:BASE_URL="http://localhost:3000"; node tests/e2e/demo-walkthrough.mjs
```
