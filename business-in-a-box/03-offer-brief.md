# 03 · Offer brief: Marquee

> **Marquee: own the door.**
> A branded box office on your own website. Your Stripe account, your customer list, one honest all-in price, and a booking fee you keep. Live in 7 days for a flat monthly fee, with no cut from us on any ticket.

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

## Plans

| | Club | Hall |
|---|---|---|
| Tickets per month | Up to 2,000 | Unlimited |
| Monthly | **$249** | **$449** |
| Setup | $750, waived for founding venues and annual plans | Same |
| Per-ticket cut from us | None | None |
| Contract | Month to month | Month to month |

**Founding-venue offer (first 10 venues):** setup waived, price locked for 12 months.

**Guarantee:** if the booking fees you keep in your first 60 days don't cover your subscription for those 60 days, we refund the difference.

**Add-ons, passed through at cost:** reserved seating and a door box office need the Hi.Events commercial licence (from €249/yr for your own events).

## The ROI maths (per venue)

Assumptions: $25 average ticket, 2 tickets per order, a venue booking fee of $2.00 per ticket inside a $27 all-in price, and Stripe's US rate of 2.9% + 30¢ per order. Source rates: Eventbrite US 3.7% + $1.79 per ticket plus 2.9% processing; Stripe 2.9% + 30¢. Both checked 2026-11-20.

**Per ticket today (Eventbrite):** $3.44 if the venue absorbs fees, or $3.54 if fees are passed to the buyer (buyer pays $28.54). The venue keeps **$0** of it.

**Per ticket with Marquee:**
- Fan pays $27.00 all-in, about **$1.45 less** than an Eventbrite checkout.
- Stripe takes about $0.93 per ticket.
- Venue keeps **$1.07 per ticket**.

| Tickets/week | Tickets/yr | Fees kept/yr | Plan | Plan cost/yr | Net gain/yr | Return |
|---|---|---|---|---|---|---|
| 100 | 5,200 | $5,548 | Club | $2,988 | $2,560 | 1.9× |
| 200 | 10,400 | $11,097 | Club | $2,988 | $8,109 | 3.7× |
| **300** | **15,600** | **$16,645** | **Club** | **$2,988** | **$13,657** | **5.6×** |
| 500 | 26,000 | $27,742 | Hall | $5,388 | $22,354 | 5.1× |
| 800 | 41,600 | $44,387 | Hall | $5,388 | $38,999 | 8.2× |

**Break-even:** about 233 tickets a month on Club.

**If the venue absorbs Eventbrite's fees today:** at 300 tickets/week it pays about $53.7k/yr. With Marquee and no added fee it pays about $13.7k in Stripe fees plus $3.0k for Club, **saving about $37k/yr**.

Recompute with each venue's own average price and volume before quoting: edit the inputs at the top of `tools/roi.py` and run `python3 tools/roi.py`.

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

- **Hi.Events** all-in-one Docker image on a small dedicated server per venue, so one venue's Friday never touches another's.
- **Transactional email** through an email provider (a Resend connector is already available in this workspace).
- **Nightly off-server backups** and **uptime monitoring** with alerts to the operator's phone.
- **Estimated cost per venue:** $30–60/mo in server, email and backups, about 75–88% gross margin on Club. Price the real stack before launch.

## Compliance and licence obligations

- **FTC Rule on Unfair or Deceptive Fees** (in force since May 12, 2025): live-event ticket prices must show the total price, mandatory fees included, upfront. Configure every venue for all-in display.
- **Hi.Events AGPL-3.0 extra terms:** keep the "Powered by Hi.Events" link on public pages and emails, and offer any code changes to users. Or buy the commercial licence for a venue that wants it removed.
- **Payments:** card payments run through Stripe on the venue's own account. The venue is the merchant of record and handles its own refunds and disputes.
- **No fake social proof:** testimonials and case studies only from real, consenting venues (FTC rule on consumer reviews and testimonials).

## Risks to manage

| Risk | Mitigation |
|---|---|
| Outage during a Friday on-sale | Server per venue, monitoring, a runbook, and a fallback "sold at the door" plan |
| Venue loses Eventbrite marketplace discovery | Keep 1–2 discovery listings on Eventbrite; move regulars and own promotion to Marquee |
| Chargebacks surprise the venue | Explain at kickoff; turn on Stripe Radar and clear refund-policy text |
| Founder becomes on-call for every venue | Standard set-up, a written runbook, and a cap on founding venues (10) |
