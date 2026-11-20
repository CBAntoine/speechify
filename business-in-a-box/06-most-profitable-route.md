# 06 · The most profitable route

## The answer

**Keep the venue business, but change how it gets paid.** Charge per ticket, not per month. Run one Hi.Events install per venue, not a shared platform. Call the busiest rooms first.

| Lever | Current plan (03) | Most profitable route |
|---|---|---|
| Price | $249/mo flat, no cut | **75¢ per paid ticket** (50¢ under $20), $99/mo minimum, no setup fee, month to month |
| Who pays | The venue, out of its kept fees | The fan. Our fee sits inside the all-in price, which is still below Eventbrite's at every price checked. |
| Delivery | One install per venue | Same: **one install per venue** on the free AGPL edition. A shared platform triggers Hi.Events' platform licence. |
| Billing | Monthly subscription | Monthly usage invoice from each install's sales report, card on file |
| Targeting | Any qualified venue | **Ranked by tickets per week:** busy comedy clubs first |
| Upsell | None | **"Fill the Room":** show emails and retargeting. Every extra ticket also earns us 75¢. |

**Effect, at 300 tickets/week per venue:** $11.7k/yr per venue instead of $3.0k (3.9×). The venue nets **more** ($16.3k vs $13.7k), and fans pay **$0.79 less** than on Eventbrite. Signing 2 venues a month, year-one revenue is about **$152k instead of $39k**, with a month-12 run-rate of about **$281k/yr instead of $72k**.

All figures come from `tools/route_model.py`: $25 tickets, 2 per order, a $2.00 venue fee, Stripe at 2.9% + 30¢, Eventbrite US rates, and about $45/mo infrastructure per venue. They're a model, not a forecast. Re-run it with each venue's real prices.

## 1. Pricing: per ticket beats flat at every venue size

| Model | Tickets/wk | Fan pays | Fan saves vs Eventbrite | Marquee revenue/yr | Venue net gain/yr |
|---|---|---|---|---|---|
| Flat $249/$449 | 100 | $27.00 | $1.54 | $2,988 | $2,560 |
| Flat $249/$449 | 300 | $27.00 | $1.54 | $2,988 | $13,657 |
| Flat $249/$449 | 800 | $27.00 | $1.54 | $5,388 | $38,999 |
| **75¢/ticket** | 100 | $27.75 | $0.79 | **$3,900** | **$5,435** |
| **75¢/ticket** | 300 | $27.75 | $0.79 | **$11,700** | **$16,306** |
| **75¢/ticket** | 800 | $27.75 | $0.79 | **$31,200** | **$43,482** |
| $1.00/ticket | 300 | $28.00 | $0.54 | $15,600 | $16,193 |

**Why both sides win:** the venue keeps its roughly $1.05 a ticket and stops paying a subscription. Our 75¢ comes from a fan fee that's still under Eventbrite's.

**Why not $1.00?** It earns more, but on tickets under about $17 fans would pay *more* than on Eventbrite. That kills the strongest line in the pitch.

**Fans still pay less at every price we checked** (venue fee $2.00, our fee 50¢ under $20 and 75¢ from $20):

| Ticket | Eventbrite fee | Marquee all-in fee | Fan saves | Venue keeps |
|---|---|---|---|---|
| $12 | $2.66 | $2.50 | $0.16 | $1.43 |
| $15 | $2.86 | $2.50 | $0.36 | $1.34 |
| $20 | $3.20 | $2.75 | $0.45 | $1.19 |
| $25 | $3.54 | $2.75 | $0.79 | $1.05 |
| $40 | $4.56 | $2.75 | $1.81 | $0.61 |

At $40+ tickets the venue should raise its own fee to $3. That's still well under Eventbrite's.

**The new pitch line:** *"No monthly fee. We earn 75¢ only when you sell, and your fans still pay less than on the big ticket sites."* It's easier to say yes to than $249/mo, because the venue has zero fixed cost and zero risk.

## 2. Delivery: one install per venue, never a shared platform

- **A shared install for several venues** needs the Hi.Events platform licence. It starts at €3,999/yr, is about 2% of sales at €200k and falls to 1% at €3M ([hi.events/licensing](https://hi.events/licensing)). At 24 venues that's **at least €30k/yr**, and sales above €3M are priced by quote.
- **One install per venue** on the free AGPL edition costs **€0 in licences**. Keep the "Powered by Hi.Events" link and publish any code changes. Each venue is the merchant of record on its own Stripe account, so Marquee never holds anyone's money.
- **Trade-off:** automatic per-sale platform fees are a feature of the platform licence. So we bill usage monthly: count paid tickets per install through the Hi.Events reports or REST API, then charge the card on file with Stripe Billing.
- **Before launch:** get written confirmation from licence@hi.events that managed single-venue installs on the free edition are fine. The licensing FAQ covers multi-organiser installs but doesn't mention agencies running separate installs.

**This route survives the worst case.** Profit per venue at 300 tickets/week if Hi.Events says a licence is needed after all:

| Model | Free AGPL | If a standard licence is needed ($4,770/yr) | If a platform licence is needed ($7,247/yr) |
|---|---|---|---|
| Flat $249 | $2,448 | **−$2,322** | **−$4,799** |
| 75¢/ticket | $11,160 | $6,390 | $3,913 |

## 3. Customers: call the busiest rooms first

Under per-ticket pricing, profit scales with volume. An 800-tickets/week room is worth $31k/yr to us and a 100/week room $3.9k. Rank every lead by **estimated tickets per week**: shows per week (from their calendar) × typical capacity × about 70% sell-through.

1. **Comedy clubs with 8+ shows a week:** multiple shows a night, general admission, highest volume
2. **Nightly listening rooms and jazz clubs**
3. **Music bars with 2–4 ticketed nights**

Lead lists get `est_tickets_week` and `est_marquee_revenue` columns, and the call list is sorted by them.

## 4. The upsell that compounds: "Fill the Room"

Weekly show emails to the venue's own list, plus retargeting ads built on the pixels we already install. These are proposed prices: **$199/mo** for email (sending costs about $20/mo) and **$399/mo + ad spend** for ads management. Under per-ticket pricing, every extra ticket this sells also earns us 75¢, so the upsell pays twice.

## 5. Routes that lost

| Route | Revenue per account/yr | Delivery effort | Sales friction |
|---|---|---|---|
| **Venues, 75¢/ticket (300/wk)** | **$11,700** | About 12 h setup, light ongoing | Low: no monthly fee |
| Venues, flat $249 | $2,988 | Same | Medium: a fixed monthly cost to justify |
| Law-firm private AI, $599/mo | $7,188 minus AI usage costs | High: data, accuracy, ethics rules | High: long trust-based sale |
| Inns direct booking, $199/mo | $2,388 | High: availability sync with OTAs | Medium |
| Shared multi-venue platform | Same as per-ticket | Lower ops | Same, but at least €30k/yr licence at 24 venues |

## 6. Risks of this route

| Risk | Handling |
|---|---|
| Big venues work out they'd keep more on flat + a higher fee of their own | Offer a monthly cap (start at $1,500/mo) only when a high-volume venue pushes back |
| Quiet months (holidays, summer) | The $99/mo minimum |
| Unpaid usage invoices | Card on file, charged automatically on the 1st, pause on failed payment |
| A venue self-hosts the open-source code and drops us | Keep the value in service: updates, Friday-night support and the "Fill the Room" marketing |
| The licence grey zone | Written confirmation from Hi.Events before the first paid venue |

## If you adopt it, these change

- `03-offer-brief.md`: plans table, guarantee (moot with no monthly fee) and ROI table switch to per-ticket
- `02-icp-and-outreach.md`: "Do you take a percentage?" answer, email 1 and the call opener
- `04-style-guide.md` and the five ads: "no cut from us" becomes "no monthly fee". Kept per ticket becomes $1.05 and fan savings $0.79.
- `05-ugc-scripts.md`: the "$249 a month flat" lines
