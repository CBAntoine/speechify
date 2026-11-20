# 07 · Getting started

What I found when I checked the plan against the real world on 2026-11-20, then the order to do things in.

## What the research changed

| Finding | Evidence | What it changes |
|---|---|---|
| **Only about 8% of indie venue sites checked sell mainly through Eventbrite** | 6 of 76 venue sites checked in Austin, Chicago, New Orleans and Nashville. Nashville had none. Most used TicketWeb (13), their own site (17), Etix (5) or 15+ other platforms. | "Eventbrite venues in 4 cities" is too small a market. Widen it (see below). |
| **The real competitor is Hi.Events' own cloud** | 1.25% + $0.60 per paid ticket, no monthly fee, and actively sold to venues ([hi.events/venue-ticketing](https://hi.events/venue-ticketing)). That's about 91¢ on a $25 ticket. | Doorkeep is still cheaper (75¢), and it's done for you. Self-hosting is what keeps it cheaper: on Hi.Events' cloud, fans would pay both fees ($28.66 all-in, above Eventbrite's $28.54). |
| **"Marquee" (the old working name) is a crowded name** | 33 live US marks in classes 9/35/41/42. They include MARQUEE for **nightclubs and special events** (Roof Deck Entertainment, reg. 5020005 and 5578930), Marquee Cinemas (which covers online ticket-fee waivers), Marquee TV and Avid's MARQUEE software. | **Renamed to Doorkeep.** Doorkeep, Doorkeeper, Houselights / "House Lights" and "Own the Door" each returned **zero** live marks in the same classes. |
| **The 75¢ fee is probably taxable in all four launch markets** | TX: data processing is taxable, with 20% exempt ([STAR](https://star.comptroller.texas.gov/view/202401030H)). TN: remotely accessed software is taxable ([notice 15-14](https://www.tn.gov/content/dam/tn/revenue/documents/notices/sales/sales15-14.pdf)). LA: prewritten computer access services are taxable from Jan 1, 2025 ([LDR](https://revenue.louisiana.gov/tax-education-and-faqs/faqs/digital-products/Louisiana-Sales-Tax-Expansion-to-Diigtal-Products-and-Services/)). Chicago: Personal Property Lease Transaction Tax on nonpossessory computer leases ([bulletin](https://www.chicago.gov/content/dam/city/depts/rev/supp_info/TaxSupportingInformation/TransTaxInfoBulletinNonpossessoryComputerLeases.pdf)). | Quote "75¢ + applicable tax". Have a CPA map where you must register (physical presence and each state's economic-nexus threshold). Venues' own ticket taxes, such as city amusement taxes, are configured in their box office on their accountant's advice. |
| **Hosting is cheap and the install is short** | DigitalOcean: 4 GB / 2 vCPU for $24/mo; daily backups +30% ([pricing](https://www.digitalocean.com/pricing/droplets)). Hi.Events quick start: `git clone` → `docker/all-in-one` → `.env` → `docker compose up -d` ([docs](https://hi.events/docs/getting-started/quick-start-self-hosted)). | About $31/mo per venue on that size, inside the $30–60 estimate. |
| **Sample lead cost** | 5 qualified leads cost about 316 Firecrawl credits (about 63 per lead) at the Eventbrite-only hit rate | Widening the criteria lowers cost per lead |

## Widening who we sell to

| List | Who | Pitch | Status |
|---|---|---|---|
| **A** | Venues selling mainly on Eventbrite, in **10+ metros** including mid-size music cities | The current pitch and maths (sourced) | Ready |
| **B** | Venues on self-serve platforms with buyer fees and no contract: Turntable Tickets, SimpleTix, Showpass, ThunderTix, TicketSource, TuneHatch, VBO, Crowdwork, Opendate, Prekindle and similar | Same pitch, using that platform's fees | **Dropped (checked 2026-11-20).** None of the 14 platforms passes. Most charge fans under $2.75 on a $25 ticket, or publish a venue fee or rebate. Prekindle ($3.09) and DICE ($3.25) charge more but publish rebates or fee splits, so treat their venues like list C. See [`research/platform-fees.md`](research/platform-fees.md). |
| **C** | TicketWeb, Etix, Ticketmaster and AXS venues | Usually under contract, and they may already get a share of fees | Ask "when does your contract end, and do you get a share of the fees?" Follow up at renewal. |
| **D** | Venues selling through their own site (WooCommerce, Wix, Squarespace): 22% of the sites checked | Door check-in, waitlists, pixels, and a booking fee they keep | A different pitch, because fans would pay more than today |
| **E** | High-volume **organisers** (comedy producers, promoters): Eventbrite's core users | One organiser per install fits the licence model | Find them through search engines and promoter pages, not Google Maps |

## The plan

### This week: no-regret steps

1. **Lock in the name: Doorkeep** (chosen 2026-11-20), tagline "Own the door." The USPTO knockout search (live marks, classes 9/35/41/42) was clean for Doorkeep and Doorkeeper. That's a screen, not clearance: have a trademark attorney clear it before you file. Then buy the domain (doorkeep.com, or a variant such as getdoorkeep.com if it's taken) and claim the Instagram handle. I couldn't check domains from here because this session's network blocks the registry lookup.
2. **Send the licence email to Hi.Events** (draft below). Nothing goes live for a paying venue until they reply.
3. **Form the business:** an LLC in your home state (fees vary by state), an EIN (free, online at irs.gov), a business bank account, and your own Stripe account for invoicing venues.
4. **Book a CPA call** on sales-tax nexus for the 75¢ fee in TX, TN, IL (Chicago) and LA, using the sources above.
5. **Get insurance quotes** for tech errors & omissions plus cyber cover, since you'll host ticket checkouts for other businesses.

### Weeks 1–2: demo, and prove venues want it

6. **One demo box office** on a $24/mo server: a fictional venue with 3 shows, all-in pricing, Stripe **test mode**, and phone check-in. Record a 90-second screen walkthrough for emails and Instagram DMs.
7. **15 discovery calls** (script below): the 5 sample leads first, then 10 more. Goal: **3 venues saying yes to a pilot** before you automate anything.
8. **Founding-venue offer:** the first 3 venues pay no Doorkeep fee for 60 days in exchange for a real case study and permission to quote them.

### Weeks 3–4: first venue live

9. Run the 7-day launch from `03-offer-brief.md`.
10. **Bill by hand at first:** export paid-ticket counts monthly and send a Stripe invoice. Automate after venue 3.
11. Write the runbook: uptime alerts, nightly backups tested by a real restore, and Friday-night on-call.

### Months 2–3: scale

12. Pull 20+ leads a week from lists A and E, plus D where the better-tooling pitch lands. List B was dropped after the fee check.
13. Run the 5 static ads and 2 UGC videos under the final name.
14. Offer the "Fill the Room" upsell to venues that have been live for 30+ days.

## Licence email (draft)

> **Subject:** Licensing question: managed single-venue installs on the AGPL edition
>
> Hi Hi.Events team,
>
> I'm starting a small service that sets up and runs self-hosted Hi.Events box offices for independent US music and comedy venues. Each venue gets its **own separate installation**: one organiser per install, its own server and database, and payments to the venue's own Stripe account. The "Powered by Hi.Events" link stays on all public pages and emails, and any code changes are published. Venues pay us a per-ticket service fee for setup, hosting and support.
>
> 1. Is that covered by the free AGPL edition, or do you treat it as hosting other organisers' events, which needs the platform price?
> 2. If a venue wants the attribution removed, or needs reserved seating or the box office, is a Standard licence for that venue's install the right route?
>
> Happy to share more detail. Thanks for building it.
>
> [Your name]

## Discovery call script (15 minutes)

1. "Walk me through how you sell tickets today. Who set it up?"
2. "Roughly how many paid tickets a month, and what's the average price?"
3. "What do fans pay in fees, and does any of it come back to you?"
4. "Are you under contract with your ticketing company? Until when?"
5. "What annoys you most: fees, payouts, data, support?"
6. Show the 90-second demo and **their own** fee maths (`tools/roi.py` with their price and volume).
7. "If we set this up in 7 days with no monthly cost, what would stop you trying it on your next on-sale?"
8. Close with the founding-venue pilot.

## What I couldn't check from here

- **Test install:** this sandbox has no Docker daemon, so I couldn't try Hi.Events here. Do it on the demo server in step 6.
- **Domain availability:** the registry lookup (rdap.verisign.com) is blocked by this session's network policy.
- **List B fee schedules:** each platform's fees still need checking before we use them in a pitch.
- **Your state's specifics:** LLC filing fee, the current Chicago lease-tax rate, and each state's nexus threshold. These go to the CPA.
