# 01 · Offer ideas (checkpoint 1)

The playbook: take a free, actively maintained open-source app and sell it to one local niche as a done-for-you monthly service. Each pitch has to pass four tests: a fee or cost the owner already resents, a licence that allows hosting it for clients, a list of leads you can pull from Google Maps, and a flat monthly price that the ROI maths clearly covers.

The three repos from the reference video (TastyIgniter, Dograh, Chatwoot) were deliberately left out.

Repo stats were pulled from GitHub on 2026-11-20.

## 1. Own Your Box Office: ticketing for independent venues (CHOSEN)

| | |
|---|---|
| Repo | [HiEventsDev/Hi.Events](https://github.com/HiEventsDev/Hi.Events): 4.2k stars, pushed 2026-11-20, AGPL-3.0 with extra terms |
| Licence fit | Free to self-host if the "Powered by Hi.Events" link stays on public pages and emails, and code changes are offered to users. A commercial licence removes the attribution: from €249/yr per own-events install, or €3,999/yr for a multi-tenant platform ([hi.events/licensing](https://hi.events/licensing)). |
| Pain | Eventbrite (US) takes 3.7% + $1.79 per paid ticket, plus 2.9% processing on the order ([Eventbrite help](https://www.eventbrite.com/help/en-us/articles/755615/how-much-does-it-cost-for-organizers-to-use-eventbrite/)). That's about $3.44–$3.54 on a $25 ticket. |
| Offer | A branded box office on the venue's own domain, paying into the venue's own Stripe account, live in 7 days, for $249/mo flat. The venue sets a booking fee inside its all-in price and keeps it. |
| ROI | 300 tickets/week × $1.07 kept ≈ $16.6k/yr, against $3.0k/yr for the service (see `03-offer-brief.md`). |
| Leads | Comedy clubs, music bars, jazz clubs and listening rooms with 4.4+ stars and 300+ reviews whose website sends buyers to eventbrite.com. That check can be automated. |

## 2. Book Direct: commission-free booking for small inns and B&Bs

| | |
|---|---|
| Repo | [Qloapps/QloApps](https://github.com/Qloapps/QloApps): 14.5k stars, pushed 2026-11-06, OSL-3.0 |
| Licence fit | Hosting for clients is allowed. OSL-3.0 treats network deployment as distribution, so changes to the core must be published. |
| Pain | Booking.com's base commission is about 15%, commonly 18–22% with visibility programmes ([tribii](https://tribii.com/journal/booking-com-commission-how-much-and-how-to-pay-less)). |
| Offer | A website, booking engine and room-management system in one, for about $199/mo. |
| ROI | A 10-room inn pays about $30k/yr in commission. Moving a quarter of OTA bookings to direct saves about $8k/yr. |
| Risk | Room availability must stay in sync with the OTAs to avoid double bookings. That needs a channel manager and makes this the hardest of the three to deliver. |

## 3. Private AI workspace for small law firms

| | |
|---|---|
| Repo | [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm): 68k stars, MIT |
| Pain | ABA Formal Opinion 512 (July 2024) puts confidentiality and competence duties on lawyers who use generative AI, so many small firms won't paste client files into public chatbots. |
| Offer | The firm's own AI workspace, loaded with its templates and precedents, for about $599/mo. |
| Trade-off | The highest price of the three, but the slowest sale and the most delivery work. |

## Rejected along the way

- **Salon and barber booking (Easy!Appointments).** Booksy is $29.99/mo and StyleSeat $19/mo, so a $149+/mo service can't win on cost. Their 30% new-client fees only apply to clients the marketplace brings in.
- **Independent car rental (BookCars).** Broker economics are margin-based and opaque, so there's no clean ROI to sell.
- **Open WebUI.** Its custom licence carries branding conditions. AnythingLLM's MIT licence is cleaner.

**Decision:** #1, own-your-box-office ticketing, US market, sold first in Central-time metros.
