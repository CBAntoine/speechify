# Research behind Rainmaker (November 2026)

Two questions shaped the product:

1. What do agencies complain about in GoHighLevel, the platform this replaces?
2. How do small agencies actually find and win local-business clients?

**How the research was done, and its limits.** The research ran on 20 Nov 2026. The sandbox could not open G2, Capterra, Trustpilot, Reddit or several survey sites directly, so every quote and figure below comes from search-engine excerpts of the linked pages. None was checked against the full page. Reddit and YouTube are barely covered. Most practitioner numbers are self-reported (Skool, Indie Hackers, Reddit) or published by vendors, so treat them as directional, not as benchmarks. Re-check anything before you put it in front of a client.

---

## 1. GoHighLevel: what users complain about

**Ratings at a glance**
- G2: 4.6/5 from about 650–670 reviews ([G2](https://www.g2.com/products/highlevel/reviews)).
- Trustpilot: 4.9/5 from 15,362 reviews. One blogger notes that many are requested right after a support chat ([websites2know](https://websites2know.com/gohighlevel-review/)).
- Software Advice: about 4.1–4.2. Its weakest sub-scores are ease of use (about 3.7) and customer service (about 3.6–3.7) ([Software Advice](https://www.softwareadvice.com/marketing/highlevel-profile/reviews/)). Unverified.

**How the complaints were ranked.** G2's review tags count learning curve (about 89–140), missing features (about 91, mostly email), poor support (about 52) and bugs (about 33) ([G2 pros and cons](https://www.g2.com/products/highlevel/reviews?qs=pros-and-cons)). One blog coded the 40 newest 1–2★ Trustpilot reviews: support 22, billing/refunds 17, cancelling 9, bugs 7, free trial 7 ([RevenueGeeks](https://revenuegeeks.com/guides/gohighlevel-reviews)).

| # | Theme | Representative evidence | What Rainmaker does about it |
|---|---|---|---|
| 1 | **Learning curve, cluttered UI** | "the layout is not always intuitive, some key options feel hidden" ([G2](https://www.g2.com/products/highlevel/reviews?qs=pros-and-cons)) | Seven screens with plain names, one main action per screen, and agents that do multi-step work from a plain-English goal. |
| 2 | **Support quality varies** | "trouble ticket after trouble ticket with no resolution" ([G2](https://www.g2.com/products/highlevel/reviews?qs=pros-and-cons)) | A small codebase you own. Every error message says what to do next. |
| 3 | **Usage fees and billing** | "on top of the monthly subscription everything cost extra" ([Capterra](https://www.capterra.com/p/177156/HighLevel/reviews/)). A wallet auto-recharge "hit our card 51 times at $10 each within 36 hours" (same source). | No wallet and no markup. You pay Claude and Google directly, each agent run has a hard dollar cap (`AGENT_RUN_BUDGET_USD`), and each run shows what it cost. |
| 4 | **Bugs and downtime** | "everywhere you turn is one giant bug after another" ([Capterra](https://www.capterra.com/p/177156/HighLevel/reviews/)); a feature-board thread asks to "fix the stability so we don't have downtime every month" ([ideas](https://ideas.gohighlevel.com/saas/p/fix-the-stability-so-we-dont-have-downtime-every-month)) | Typed, tested code; production build verified; agent loops can run on Anthropic's Managed Agents infrastructure. |
| 5 | **SMS registration and email deliverability** | "setting up a phone number for SMS took us 5 weeks" ([Capterra](https://www.capterra.com/p/177156/HighLevel/reviews/)); "LC emails ending up in junk" ([ideas](https://ideas.gohighlevel.com/lcemailsystem/p/lc-emails-ending-up-in-junk)) | Email goes from your own verified domain (Resend) or your own mail app, never a shared pool. Texts open in your phone's Messages app. |
| 6 | **Clunky funnel builder** | "Clunky website and funnel builder" ([ideas](https://ideas.gohighlevel.com/website/p/clunky-website-and-funnel-builder)) | No builder. Ad Studio writes the landing-page copy for the builder you already use. |
| 7 | **Workflow builder is slow or fragile** | "automations slow to a crawl" ([G2 discussion](https://www.g2.com/discussions/unstable-workflows-and-random-glitches-slow-down-client-work-and-force-me-to-recheck-everything)) | Agents take a goal in plain English instead of a node graph. |
| 8 | **Weak reporting** | "we really need an adhoc reporting solution" ([ideas](https://ideas.gohighlevel.com/ad-reporting-and-attribution/p/we-really-need-an-adhoc-reporting-solution-within-ghl-where-i-can-create-my-own)) | The Today screen shows pipeline value, recurring revenue and what to do next. Reporting is still basic (see README, "Not built yet"). |
| 9 | **Mobile app** | "Lead connector app seems buggy and keeps breaking" ([ideas](https://ideas.gohighlevel.com/mobile-app/p/lead-connector-app-seems-buggy-and-keeps-breaking)) | A responsive web app; every screen works at phone width. |
| 10 | **AI add-ons are expensive** | "how can we sell this when its so EXPENSIVE for the customer" ([ideas](https://ideas.gohighlevel.com/conversation-ai/p/how-can-we-sell-this-when-its-so-expensive-for-the-customer)) | Claude is built into every screen at API cost, and nothing goes out without approval. |
| 11 | **It doesn't find clients** | "the software is a tool. It does not bring you clients. You bring clients to it." (a vendor review, [AutoGen CRM](https://autogencrm.com/gohighlevel-review/)) | Finding clients is the center of the product. See section 2. |

**What users praise, and what to keep:** all-in-one value, automation, unlimited contacts and users, agency economics (sub-accounts, white-label, SaaS resale), and new features shipping fast ([G2](https://www.g2.com/products/highlevel/reviews?qs=pros-and-cons), [Capterra](https://www.capterra.com/p/177156/HighLevel/reviews/), [pricing guide](https://help.gohighlevel.com/support/solutions/articles/155000001156-highlevel-pricing-guide)).

**Pricing (Nov 2026):**
- Plans: Starter $97/mo, Unlimited $297/mo, Founder (formerly Agency Pro) $497/mo ([pricing](https://www.gohighlevel.com/pricing)).
- Paid on top, from a prepaid wallet:
  - LC Email: $0.675 per 1,000 emails.
  - SMS: $0.00747 per segment.
  - A2P registration: $22.50–$64 one-time, plus monthly fees per campaign.
  - Premium workflow actions: $0.01 per execution.
  - AI Employee: $20–$97/mo per sub-account.

  Sources: [pricing guide](https://help.gohighlevel.com/support/solutions/articles/155000001156-highlevel-pricing-guide), [AI pricing](https://help.gohighlevel.com/support/solutions/articles/155000006652-ai-product-pricing), [A2P fees](https://help.gohighlevel.com/support/solutions/articles/155000005200-a2p-10dlc-messaging-fees-registration-monthly-and-carrier-costs).

---

## 2. How agencies find and win local clients

### Channels, by how often agencies credit them

| # | Channel | Evidence |
|---|---|---|
| 1 | Referrals and word of mouth | 66% name client referrals as their top source ([SparkToro 2025](https://sparktoro.com/blog/digital-agency-new-business-still-a-concern-referrals-still-rule-for-lead-gen-and-are-sales-pipelines-finally-recovering/)); 85% cite referrals ([AgencyAnalytics 2026, n=494](https://agencyanalytics.com/blog/agency-benchmarks-2026-ai-search)) |
| 2 | Cold outbound | 33% ([AgencyAnalytics](https://agencyanalytics.com/blog/agency-benchmarks-2026-ai-search)). Of the agencies that tried it, only 9% call it "very effective" ([SparkToro](https://sparktoro.com/blog/digital-agency-new-business-still-a-concern-referrals-still-rule-for-lead-gen-and-are-sales-pipelines-finally-recovering/)) |
| 3 | SEO and content | 38–39% ([AgencyAnalytics](https://agencyanalytics.com/blog/agency-benchmarks-2026-ai-search), [SEOFOMO via SEJ](https://www.searchenginejournal.com/survey-shows-where-seos-get-their-clients/525399/)) |
| 4 | Events and speaking | Speaking rose to 4th place in SparkToro's survey; events cited by 25% (SEOFOMO) |
| 5 | Paid ads for the agency itself | 9–26% |
| 6 | Social and communities | 19–26% |

Surveys sample established agencies. People starting out in SMMA, GoHighLevel and AI-automation forums say their first clients came from outbound.

### Outbound results people report (self-reported, small samples)
- **Cold email:**
  - Across one large sending platform: 3.43% average reply rate, the top 10% of senders at 10.7% or more, and 42% of replies coming after the first email ([Instantly](https://instantly.ai/cold-email-benchmark-report-2026)).
  - One sender: 2,352 emails → 9 calls → $19k in pipeline ([Skool](https://www.skool.com/ai-automation-society/2352-emails-sent-9-sales-calls-booked-19000-in-pipeline)).
- **Video audits (Loom):** one agency reports a 15% reply rate, against 3–8% for plain text ([Skool](https://www.skool.com/agencyworld/how-im-getting-15-reply-rates-with-loom-outreach-exact-breakdown)). Another got more replies after dropping per-prospect videos ([Skool](https://www.skool.com/lead-gen/i-stopped-sending-looms-replies-went-up)).
- **Cold calls:** one agency built lists of 30–50 businesses per niche and closed a first client after 3 days of calling in its third niche ([Skool](https://www.skool.com/gohighlevel/closed-my-first-client-after-3-days-of-cold-calling)).
- **Spec work:** 47 businesses analysed → 12 free redesigns → 1 sale in week one ([DEV](https://dev.to/ryancwynar/building-an-ai-powered-lead-gen-machine-from-ugly-websites-to-paying-clients-474a)).

### Signals used to pick prospects, and how Rainmaker detects each
I found no independent reply-rate data for any single signal.

| Signal | In Rainmaker |
|---|---|
| No website (about 30% of listings in one 100-business test; franchises show up as false positives) | `no_website`, plus a confirm-first warning for map data |
| Few or weak reviews | `few_reviews`, `low_rating` (needs a Google Places key) |
| High rating with many reviews (established, can pay) | `established` (shown as a positive) |
| Running ads, or not ([Meta Ad Library](https://neilpatel.com/blog/facebook-ads-library/)) | Ad pixel detection (`runs_ads` / `no_pixel`) and a Meta Ad Library link on every business |
| Slow, insecure or not mobile-friendly site ([Insites](https://insites.com/how-to-use-free-audits-as-a-lead-generation-tool-for-your-marketing-agency)) | `slow`, `no_https`, `not_mobile` |
| No online booking | `no_booking` (24 booking tools detected) |
| Missed calls or slow follow-up (found by mystery-shopping the business) | `no_chat`, `no_form`, plus the "Missed-call mystery shop" playbook |
| Hiring for marketing roles ([lemlist](https://www.lemlist.com/blog/hiring-as-buying-intent-signal)) | Playbook |
| Newly registered business ([KY](https://sos.ky.gov/bus/Pages/File-Descriptions.aspx), [ND](https://www.sos.nd.gov/services/data-list-requests)) | Playbook |
| Already uses GoHighLevel | `uses_ghl` (LeadConnector widget or site detected) |

### Lead sources
- **Google Maps data:** best for lists by city and category. Phone numbers were 92% accurate in one 100-call test ([DEV](https://dev.to/alexberman1/google-maps-vs-yelp-vs-apollo-which-has-better-b2b-data-2n43)). Rainmaker uses the Google Places API when you add a key and free OpenStreetMap data when you don't.
- **Apollo-style contact databases:** weak for local businesses. In the same test, 22% of phone numbers were wrong and 15–20% of emails bounced, and Clay notes these databases depend on a digital footprint local businesses rarely have ([Clay](https://www.clay.com/guides/how-to-scrape-google-maps-for-leads)).

### Outreach that works
- **Structure:** a specific observation → the pain it causes → proof → a simple call to action ([lemlist](https://www.lemlist.com/blog/how-to-write-a-cold-email-that-sells-smma)).
- **Length:** under about 80 words ([Prospeo](https://prospeo.io/s/cold-email-for-smma)).
- **Follow-ups:** three of them.
- **Low-risk entry offers:** a pay-per-lead pilot, missed-call text-back, or reactivating the client's old customer list ([Instantly](https://instantly.ai/blog/how-to-get-smma-clients/), [Skool](https://www.skool.com/gohighlevel/dr-client-using-robbs-closing-script)).

Rainmaker's outreach prompt and templates follow this structure. They also add a postal address and an opt-out line to every email (CAN-SPAM) and "Reply STOP" to every text.

### Niche data
Sourced values per niche, such as the value of a new dental patient, a med-spa visit or a roof replacement, the best offers and the cost per lead by channel, live in `src/lib/niches.ts` (`RESEARCH`). They appear in the app under Find clients → "Winning …" and on Playbooks → Niche cheat sheets, each with its source link.

**Not verified:** LinkedIn Sales Navigator for local niches, walk-in conversion rates, reply rates for individual signals, and lifetime value for chiropractors and restaurants. Several pages titled "2026 benchmarks" are agency marketing and contradict each other.
