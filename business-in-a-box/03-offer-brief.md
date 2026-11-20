# 03 · Offer brief: Marquee

> **Marquee: own the door.**
> A branded box office on your own website. Your Stripe account, your customer list, one honest all-in price, and a booking fee you keep. **No monthly fee:** we earn 75¢ only when you sell, and your fans still pay less than on the big ticket sites. Live in 7 days.

*"Marquee" is a working brand name. Run a USPTO trademark search before buying a domain or printing anything.*

## What the venue gets

1. **Your own box office** at `tickets.yourvenue.com`, styled to your brand. It's built on Hi.Events (open source) and hosted and maintained by us.
2. **Payments straight to your own Stripe account.** We never touch your money.
3. **Your booking fee, kept.** It's built into one all-in price, as the FTC fee rule requires.
4. **Embeds on your current website:** buy buttons, event lists and lineups.
5. **Door check-in** by phone camera or USB scanner, with shareable live check-in lists for door staff.
6. **Promo codes, hidden presale tickets, waitlists and capacity limits**, plus tracking links for promoters.
7. **Meta, TikTok and Google pixels** wired in, so your ads can finally see ticket sales.
8. **Your customer list:** marketing opt-in at checkout and CSV/XLSX exports.
9. **Launch help:** we rebuild your upcoming shows, train your door staff, and send your list a "new box office" announcement.
10. **Ongoing support:** monitoring, nightly backups, updates, and a Friday-night response plan.

## Pricing

| | |
|---|---|
| **Per paid ticket** | **75¢** on tickets of $20 and up, **50¢** under $20. Free tickets are free. |
| Monthly fee | **None** |
| Setup | **None.** The 7-day launch is included. |
| Contract | Month to month. Cancel any time and take your events and customer list with you (CSV/XLSX). |
| Billing | Invoiced monthly in arrears from your box office's sales report, charged to a card on file |

How the fan's price is built for a $25 show: face value $25.00, plus a booking fee of $2.75 (your $2.00 plus our 75¢), so **$27.75 all-in**. That's the one price the fan sees.

**Who we onboard:** venues selling **400+ paid tickets a month** (about 2+ ticketed shows a week). This is a qualification rule, not a fee. It keeps every account worth its setup time without adding a monthly minimum.

**Negotiation lever, not advertised:** for very high-volume venues that push back, a monthly cap starting at $1,500/mo.

**Add-on: "Fill the Room"** (proposed): weekly show emails to your list for $199/mo, plus retargeting ads for $399/mo + ad spend. Every extra ticket sold also earns our 75¢.

**Passed through at cost:** reserved seating and a door box office need the Hi.Events commercial licence.

## The ROI maths (per venue)

Assumptions: $25 average ticket, 2 tickets per order, a $2.75 booking fee ($2.00 venue + 75¢ Marquee) inside a $27.75 all-in price, and Stripe US at 2.9% + 30¢ per order. Source rates: Eventbrite US 3.7% + $1.79 per ticket plus 2.9% processing; Stripe 2.9% + 30¢. Both checked 2026-11-20.

**Per ticket today (Eventbrite, fees passed to the fan):** the fan pays $28.54, of which **$3.54 is fees**. The venue keeps **$0** of it.

**Per ticket with Marquee:**
- Fan pays $27.75 all-in, **79¢ less** than on Eventbrite.
- Stripe takes about 95¢ and Marquee takes 75¢.
- Venue keeps **$1.05 per ticket**, with no monthly fee.

| Tickets/week | Tickets/yr | Venue keeps/yr | Marquee earns/yr |
|---|---|---|---|
| 100 | 5,200 | $5,435 | $3,900 |
| 200 | 10,400 | $10,871 | $7,800 |
| **300** | **15,600** | **$16,306** | **$11,700** |
| 500 | 26,000 | $27,177 | $19,500 |
| 800 | 41,600 | $43,482 | $31,200 |

**Fans pay less than on Eventbrite at every price checked:** $12, $15, $20, $25 and $40 tickets. At $40+ the venue should raise its own fee to $3 (see `06-most-profitable-route.md`).

**If the venue absorbs Eventbrite's fees today:** at 300 tickets/week it pays about $53.7k/yr. With Marquee and no fee added for fans, it pays only Stripe plus our 75¢, about $25.4k/yr, **saving about $28.3k/yr**.

Recompute with each venue's own prices and volume before quoting: `python3 tools/roi.py` (inputs at the top of the file).

## The 7-day launch

| Day | What happens |
|---|---|
| 1 | Kickoff call. The venue creates or links its Stripe account. DNS record for `tickets.` added. |
| 2 | Box office deployed (Docker) and branded: logo, colours, fee and tax settings, all-in price display. |
| 3 | Upcoming shows rebuilt (dates, tiers, capacity, presale codes). Shows already on sale stay on Eventbrite. |
| 4 | Embeds and buy buttons placed on the venue's website. Pixels and analytics connected. |
| 5 | Test purchases, refund test, door check-in drill with staff phones. |
| 6 | Mailing-list import (opt-in contacts) and "new box office" announcement drafted. |
| 7 | Live with the next show that goes on sale. |

## Delivery stack and unit economics

- **One Hi.Events install per venue** (all-in-one Docker image) on a small dedicated server, so one venue's Friday never touches another's. Keeping one install per venue also avoids Hi.Events' platform licence for multi-organiser installs (see `06-most-profitable-route.md`).
- **Transactional email** through an email provider (a Resend connector is already available in this workspace).
- **Nightly off-server backups** and **uptime monitoring** with alerts to the operator's phone.
- **Usage billing:** a monthly job reads paid-ticket counts from each install (reports or REST API) and invoices through Stripe Billing on Marquee's own account.
- **Estimated cost per venue:** $30–60/mo in server, email and backups. At 300 tickets/week Marquee earns about $975/mo per venue, so **about 95% gross margin**. Price the real stack before launch.

## Compliance and licence obligations

- **FTC Rule on Unfair or Deceptive Fees** (in force since May 12, 2025): live-event ticket prices must show the total price, mandatory fees included, upfront. Configure every venue for all-in display. Our 75¢ is part of the booking fee inside that price.
- **Hi.Events AGPL-3.0 extra terms:** keep the "Powered by Hi.Events" link on public pages and emails, and publish any code changes. One organiser per install. **Get written confirmation from licence@hi.events that managed single-venue installs are fine on the free edition before the first paid venue.**
- **Payments:** card payments run through Stripe on the venue's own account. The venue is the merchant of record and handles its own refunds and disputes. Marquee invoices only its own per-ticket fee.
- **No fake social proof:** testimonials and case studies only from real, consenting venues (FTC rule on consumer reviews and testimonials).

## Risks to manage

| Risk | Mitigation |
|---|---|
| Outage during a Friday on-sale | Server per venue, monitoring, a runbook, and a fallback "sold at the door" plan |
| Venue loses Eventbrite marketplace discovery | Keep 1–2 discovery listings on Eventbrite; move regulars and own promotion to Marquee |
| Chargebacks surprise the venue | Explain at kickoff; turn on Stripe Radar and clear refund-policy text |
| Unpaid usage invoices | Card on file, charged automatically on the 1st; pause new on-sales after a failed payment |
| Big venues prefer to raise their own fee and pay us flat | The monthly-cap lever, used only when pushed |
| Founder becomes on-call for every venue | Standard set-up, a written runbook, and a cap on founding venues (10) |
