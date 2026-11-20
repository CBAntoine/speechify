# Business in a box: Marquee

A done-for-you ticketing business for independent US venues, built on the open-source [Hi.Events](https://github.com/HiEventsDev/Hi.Events) platform. Marquee gives a venue its own branded box office, so it stops sending fans through Eventbrite and keeps its own booking fee. There's no monthly fee: Marquee earns 75¢ per paid ticket (50¢ under $20), built into an all-in price that's still lower for fans.

This follows the "business in a box" process: offer ideas → niche and ICP → offer brief and style guide → verified leads → creatives, with an approval checkpoint between stages.

| File | What it is |
|---|---|
| [`01-offer-ideas.md`](01-offer-ideas.md) | The three open-source offers pitched, and why ticketing won |
| [`02-icp-and-outreach.md`](02-icp-and-outreach.md) | Ideal customer, qualifiers, metros, pricing ceilings, objections, calling windows, first-touch scripts |
| [`03-offer-brief.md`](03-offer-brief.md) | The offer, plans, guarantee, ROI maths, 7-day launch, unit economics, compliance |
| [`04-style-guide.md`](04-style-guide.md) | Palette hex codes with contrast ratios, type, motifs, copy rules, ad specs, the five planned statics |
| [`05-ugc-scripts.md`](05-ugc-scripts.md) | Two 9:16 UGC scripts with timings and on-screen text |
| [`06-most-profitable-route.md`](06-most-profitable-route.md) | Most profitable route: per-ticket pricing, one install per venue, busiest rooms first, plus the routes that lost |
| [`tools/roi.py`](tools/roi.py) | Per-venue fee and ROI calculator |
| [`tools/route_model.py`](tools/route_model.py) | Pricing route model: flat vs per-ticket, fan-price check, licence downside, 12-month scenario |
| `leads/` | Lead lists. **Git-ignored on purpose:** they hold named people's contact details and this repo is public. |

## Status

- [x] Checkpoint 1: offer chosen (venue ticketing, US)
- [x] ICP, offer brief, ROI maths, style guide, UGC scripts
- [x] Most profitable route worked out (06) and adopted: per-ticket pricing, docs updated
- [ ] Checkpoint 2: approve 5 sample leads
- [ ] Pull 15 more leads (20 total)
- [ ] 5 static Meta ads
- [ ] UGC videos (needs an avatar tool, or the faceless voiceover route)

## Facts used, all checked 2026-11-20

- Eventbrite US: 3.7% + $1.79 per paid ticket plus 2.9% processing ([source](https://www.eventbrite.com/help/en-us/articles/755615/how-much-does-it-cost-for-organizers-to-use-eventbrite/))
- Stripe US: 2.9% + 30¢ per successful domestic card charge ([source](https://stripe.com/pricing))
- Hi.Events: AGPL-3.0, "Powered by Hi.Events" attribution required unless licensed. Reserved seating and the door box office are Enterprise features ([licensing](https://hi.events/licensing), [README](https://github.com/HiEventsDev/Hi.Events))
- FTC Rule on Unfair or Deceptive Fees (all-in pricing for live-event tickets), effective May 12, 2025 ([FTC](https://www.ftc.gov/news-events/news/press-releases/2025/05/ftc-rule-unfair-or-deceptive-fees-take-effect-may-12-2025))
