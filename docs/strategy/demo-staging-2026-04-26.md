# Recorded Demo: Staging Layer (E-Commerce Orders)

**Date:** 2026-04-26
**Layer under demo:** Staging (dataset upload + cleanup via chat)
**Domain:** E-commerce orders
**Length:** ~15 minutes recorded
**Audience:** Internal team + non-technical stakeholders

---

## Domain Framing

**Who the user is.** A business analyst at a mid-size online retailer. Their data team dumped a year of order export into a CSV and dropped it on Slack. Before anyone can build a dashboard from it, the analyst needs to clean the obvious mess — region names typed five different ways, dollar signs in price columns, missing discount values, dates in two formats. Today they'd open Excel and spend an afternoon. In dashboard_chat, they upload the CSV and **talk** to it.

**The BI question they're trying to answer.** "How are our orders distributed by region and category, and which payment methods are people actually using?" That question can't be answered cleanly until the staging layer is consistent. This demo proves the staging layer can get them there.

**Why e-commerce.** Universally relatable — every viewer has bought something online and intuitively understands what "an order" means. No domain jargon to translate. The mess in the CSV is the kind of mess every real export has.

---

## Pre-Flight Checklist

Run through this **before hitting record**. If any item fails, fix it first — re-recording is more expensive than a 60-second checklist.

- [ ] Dev stack is running: `npm run dev` from `~/gt/dashboard_chat/crew/dave` (frontend on :5173, backend on :8000, worker on :8787)
- [ ] Browser open to `http://localhost:5173` and you can sign in (dev mode auto-logs as `dev-user-001`)
- [ ] You can see an empty project list, OR you've created a fresh project named **"E-Commerce Demo"** with nothing in it yet
- [ ] CSV exists and you can find it: `/usr/local/share/dc-demo-data/ecommerce-orders.csv` (250 rows)
- [ ] Screen recorder is running (OBS, Loom, QuickTime — operator's choice). Record at 1080p or higher; window-only capture preferred over full screen
- [ ] Microphone audio is enabled and tested — narrate as you go
- [ ] You have this doc open in another window for the script
- [ ] Friction-capture table (below) is open in a notes app, ready to fill in real time
- [ ] Browser zoom set so chat panel and table are both readable on the recording

---

## Recording Script

The script uses **plain conversational chat turns** — type them as if you were a real analyst. The agent should pick the right tools on its own; if it doesn't, that's a finding to capture, not a script error.

> **Narration tip:** Before each turn, briefly say what you're trying to accomplish ("Now I want to get rid of the dollar signs in the price column"). After each turn, point to what changed ("See — the price column is now numeric, you can tell because it's right-aligned").

### Act 1 — Upload (≈2 min)

| Step | What you do | What you should see |
|---|---|---|
| 1 | Open the project, click the **Actions** button (gear icon, top right of chat) → **Create Dataset** | Upload widget appears in chat with a "Browse" button |
| 2 | Click Browse, pick `ecommerce-orders.csv` from `/usr/local/share/dc-demo-data/` | File name shows in widget; "Send" button appears |
| 3 | Click **Send** | Widget transitions through "Uploading" → "Uploaded"; agent posts a confirmation message; new dataset appears in the left rail |
| 4 | Click the new dataset to open the detail view | Table loads showing 250 rows × 11 columns |

**On camera, say:** "We just uploaded raw order data. Notice the columns — region, product category, payment method — all of them have inconsistent formatting. That's what we're going to fix by talking to the chat."

### Act 2 — Eyeball the Mess (≈1 min)

Don't type anything yet. Scroll through the table and **point out** specific rows on camera:

- Row 1: region is `" North "` (leading + trailing spaces), category is `"APPAREL "` (uppercase + trailing space)
- Row 5: category is `"Electornics"` — that's a typo
- Row 4: unit price is `"$51.67"` — has a dollar sign, can't be summed as-is
- A row with empty `discount_pct`
- The `order_date` column has both `2025-02-22` and `08/27/2025` formats

**On camera, say:** "If we tried to count orders by region right now, we'd get fifteen regions instead of four. Same problem on category and payment method. Let's clean it up."

### Act 3 — Cleanup via Chat (≈10 min)

Type each prompt as a separate chat turn. **Wait for the agent to finish each one** before sending the next — don't queue prompts.

| # | Chat prompt to type (verbatim) | What you should see in the table |
|---|---|---|
| 1 | `Trim whitespace on every text column` | Leading/trailing spaces gone in region, customer_email, product_category, payment_method, shipping_status |
| 2 | `Standardize the region column to title case` | All values become `North`, `South`, `East`, `West` (4 distinct values) |
| 3 | `The product category has typos — fix "Electornics" to "Electronics" and standardize everything to title case` | Category column now has exactly 5 clean values: Electronics, Apparel, Home Goods, Books, Toys |
| 4 | `Standardize payment_method to a single canonical form per method (e.g. "Credit Card" not "credit_card")` | Payment column collapses to ~4 distinct values: Credit Card, PayPal, Apple Pay, Bank Transfer |
| 5 | `Standardize shipping_status to title case` | Shipping column reduces to: Delivered, Pending, Shipped, Cancelled |
| 6 | `Strip the dollar sign from unit_price and convert it to a number` | unit_price column right-aligns; you can see decimals consistently |
| 7 | `The order_date column has two different formats. Convert everything to ISO format (YYYY-MM-DD)` | All dates look like `2025-MM-DD` |
| 8 | `Fill missing values in discount_pct with 0` | No more blanks in the discount column |
| 9 | `Show me the count of orders by region` | Agent responds with a count breakdown — 4 regions, totals add to 250 |
| 10 | `And by product category` | Same shape, 5 categories, totals add to 250 |

**On camera, after step 10, say:** "Ten chat turns. The data is clean enough that we can start asking real BI questions. That's the staging layer doing its job."

### Act 4 — Wrap (≈1 min)

- [ ] Click the dataset name in the breadcrumb, rename to `ecommerce_orders_clean` (note: the demo also exercises rename)
- [ ] Stop recording
- [ ] Save the recording to a known location, name it `demo-staging-2026-04-26.<ext>`
- [ ] Save your friction-capture notes alongside it

---

## Friction-Capture Template

Fill in **as you go**, not after. Memory of "what felt off" decays fast. One row per surprise.

| Step | Expected | Actual | Severity | Bead to file |
|---|---|---|---|---|
| _e.g. 3_ | _Agent fixes "Electornics" + standardizes case in one turn_ | _Agent only fixed the typo, ignored case standardization — needed to re-prompt_ | _annoys_ | _bug: combined cleanup prompts not handled atomically_ |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

**Severity scale:**
- `blocks` — the demo cannot proceed; loop is broken
- `annoys` — works but takes extra prompts, confuses the user, slow, or surfaces a misleading error
- `nice` — minor polish (wording, spacing, animation)

**Bead-to-file column** — write the working title only. Actually filing the beads happens after the demo, not during.

---

## Success Criteria

The staging layer is **validated by this demo** if all of the following are true after recording:

1. ✅ The CSV uploaded successfully on the first try (no retries needed)
2. ✅ At least 8 of the 10 cleanup prompts in Act 3 worked on the first ask (≤2 reprompts is acceptable; >2 means the staging chat tools have a real coverage gap)
3. ✅ The final two count queries (steps 9 and 10) returned correct totals (250 rows accounted for in each breakdown)
4. ✅ No agent error messages were shown to the user that weren't immediately understandable to the operator
5. ✅ Total recording length is under 18 minutes (overage signals slow tool calls or excessive reprompting — capture as friction)

If all 5 are met → staging layer is **green for demo purposes**. We can move on to the view-layer demo next.
If 1–2 fail → file the gaps as beads and decide whether to retake or proceed.
If ≥3 fail → escalate to mayor; we may not be ready for the full-loop e2e test yet.

---

## Out of Scope (Explicit)

To keep this demo disciplined and short, the following are **deliberately not covered**:

- ❌ **View layer** (intermediate models, joins, filters as saved transformations) — gets its own demo
- ❌ **Report layer** (dimensions, measures, aggregations) — gets its own demo
- ❌ **dbt project export** — gets its own demo
- ❌ **Healthcare adaptations** of this dataset — separate exercise; staging layer needs to work in a generic BI context first
- ❌ **Performance benchmarking** — this is a workflow demo, not a load test
- ❌ **Multi-user / collaboration scenarios** — single operator only
- ❌ **Auth flows** — assumed working; operator is already signed in before recording starts

Anything that surfaces in those areas during the recording goes into the friction table tagged with the layer name, but is **not investigated on camera**. Stay on staging.

---

## Artifacts Produced by This Demo

After the recording wraps, the operator should have:

1. The video file (`demo-staging-2026-04-26.<ext>`) — share location TBD
2. The completed friction-capture table — paste into a follow-on doc `demo-staging-friction-2026-04-XX.md`
3. A list of bead titles ready to file under the parent demo bead

Those three together are the deliverable. The video alone isn't enough — the friction table is what feeds the next round of work.
