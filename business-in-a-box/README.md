# Business in a box: Doorkeep

A done-for-you ticketing business for independent US venues, built on the open-source [Hi.Events](https://github.com/HiEventsDev/Hi.Events) platform. Doorkeep gives a venue its own branded box office, so it stops sending fans through Eventbrite and keeps its own booking fee. There's no monthly fee: Doorkeep earns 75¢ per paid ticket (50¢ under $20), built into an all-in price that's still lower for fans.

This follows the "business in a box" process: offer ideas → niche and ICP → offer brief and style guide → verified leads → creatives, with an approval checkpoint between stages.

| File | What it is |
|---|---|
| [`01-offer-ideas.md`](01-offer-ideas.md) | The three open-source offers pitched, and why ticketing won |
| [`02-icp-and-outreach.md`](02-icp-and-outreach.md) | Ideal customer, qualifiers, metros, pricing ceilings, objections, calling windows, first-touch scripts |
| [`03-offer-brief.md`](03-offer-brief.md) | The offer, plans, guarantee, ROI maths, 7-day launch, unit economics, compliance |
| [`04-style-guide.md`](04-style-guide.md) | Palette hex codes with contrast ratios, type, motifs, copy rules, ad specs, the five planned statics |
| [`05-ugc-scripts.md`](05-ugc-scripts.md) | Two 9:16 UGC scripts with timings and on-screen text |
| [`06-most-profitable-route.md`](06-most-profitable-route.md) | Most profitable route: per-ticket pricing, one install per venue, busiest rooms first, plus the routes that lost |
| [`07-getting-started.md`](07-getting-started.md) | Research findings (market size, the real competitor, the name, sales tax, hosting) and the launch plan, plus the licence email and discovery-call script |
| [`site/`](site/) | Landing page with the fee calculator (same maths as `tools/roi.py`), how it works, pricing and FAQ. A static file with no backend, so it can go on any static host (GitHub Pages, Netlify, Cloudflare Pages). **Before publishing:** set `<meta name="booking-url">` to your booking link. Until then, the booking buttons scroll to the bottom of the page. Previews: `site/preview-desktop.png`, `site/preview-mobile.png`. |
| [`video/`](video/) | Two faceless UGC videos (9:16) with ElevenLabs voiceover, plus their sources and build scripts |
| [`app/call-sheet.html`](app/call-sheet.html) | Source of the **Doorkeep Call Sheet** phone app, published privately as a Claude artifact. It holds the call list with local call windows, call and email drafts, the cadence tracker, pipeline, fee calculator and scripts. Lead data lives in the artifact's private database (owner and Editors only), never in this file. |
| [`tools/roi.py`](tools/roi.py) | Per-venue fee and ROI calculator |
| [`tools/route_model.py`](tools/route_model.py) | Pricing route model: flat vs per-ticket, fan-price check, licence downside, 12-month scenario |
| `leads/` | Lead lists. **Git-ignored on purpose:** they hold named people's contact details and this repo is public. |

## Status

- [x] Checkpoint 1: offer chosen (venue ticketing, US)
- [x] ICP, offer brief, ROI maths, style guide, UGC scripts
- [x] Most profitable route worked out (06) and adopted: per-ticket pricing, docs updated
- [x] Getting-started research and launch plan (07)
- [x] Checkpoint 2: 3 of 5 sample leads kept, name changed to Doorkeep, targeting widened
- [x] 5 static Meta ads in [`ads/`](ads/), with ad text, headlines and descriptions in `04-style-guide.md`
- [x] Fee research on 14 other platforms ([`research/platform-fees.md`](research/platform-fees.md)): none passes, so list B was dropped
- [ ] Leads: 15 of 20 merged into `leads/leads.csv` (9 ready, 3 need contact details, 3 on hold). Remaining email lookups and 5 more venues wait for the Firecrawl daily reset.
- [x] UGC videos: two faceless versions with ElevenLabs voiceover in `video/`
- [x] Landing page with fee calculator in `site/` (set the booking link before publishing)
- [x] Phone app: the Doorkeep Call Sheet, a private Claude artifact seeded with the 15 leads
- [x] Outreach sequence complete in `02` (emails 1–3, voicemail, call openers, CAN-SPAM rules). Personalised drafts for the 9 ready leads are in `leads/outreach-drafts.md` (git-ignored, not sent).

## Facts used, all checked 2026-11-20

- Eventbrite US: 3.7% + $1.79 per paid ticket plus 2.9% processing ([source](https://www.eventbrite.com/help/en-us/articles/755615/how-much-does-it-cost-for-organizers-to-use-eventbrite/))
- Stripe US: 2.9% + 30¢ per successful domestic card charge ([source](https://stripe.com/pricing))
- Hi.Events: AGPL-3.0, "Powered by Hi.Events" attribution required unless licensed. Reserved seating and the door box office are Enterprise features ([licensing](https://hi.events/licensing), [README](https://github.com/HiEventsDev/Hi.Events))
- FTC Rule on Unfair or Deceptive Fees (all-in pricing for live-event tickets), effective May 12, 2025 ([FTC](https://www.ftc.gov/news-events/news/press-releases/2025/05/ftc-rule-unfair-or-deceptive-fees-take-effect-may-12-2025))
