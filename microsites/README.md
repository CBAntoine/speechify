# Microsites: Ontario rank-and-rent pilot

This folder runs the seven-step plan:

1. Pick an urgent, high-ticket niche.
2. Pilot one sub-niche in one city.
3. Register an exact-match domain.
4. Build a flat HTML site.
5. Keep sites isolated.
6. Add a tracking number with AI call qualification.
7. Let the site age, then scale.

It holds the pilot site, a small builder for adding more, and the AI agent that answers calls. The Neon Atlas app elsewhere in this repo doesn't use any of it.

**The pilot: backwater valves and sump pumps in Mississauga, Ontario.** An earlier Houston, Texas version was replaced when the project moved to Ontario. It's still in git history (commit `fbaacbb`).

## Where things stand (checked 2026-11-20)

| Step | Status |
| --- | --- |
| 1. Niche | Plumbing, specifically basement flood protection. It's urgent after storms, the jobs are high-ticket, local plumbers compete for it, and City and Region rebates drive demand. |
| 2. Pilot | **Backwater valves and sump pumps in Mississauga.** |
| 3. Domain | **backwatervalvemississauga.ca** had no DNS records, so it's very likely unregistered. Confirm at the registrar. Namecheap lists .ca at US$11.98 for the first year and US$14.98 a year after. **Not registered yet.** |
| 4. Site | Built: 8 pages of static HTML, about 120 KB in total, with no JavaScript. Not deployed yet. |
| 5. Isolation | Enforced by the build. A site that links to another site in `sites/` fails to build. |
| 6. Calls | ElevenLabs agent retargeted to Mississauga. Its 7 safety and honesty tests pass 14 of 14 runs. **No phone number yet, on purpose.** See [voice-agent/README.md](voice-agent/README.md). |
| 7. Age and scale | The clock starts when the site goes live. |

### Why not water heaters in Ontario

The Government of Canada notes that Ontario water heaters are "predominantly rented". Enercare alone rents out about 1.1 million, and Reliance holds much of the rest. Renters call their rental company when a tank fails, so search results and jobs are dominated by national brands. That fails step 1.

### Domains checked on 2026-11-20

Namecheap couldn't confirm .ca availability directly, so "looks free" means the name had no DNS records.

| | Domains |
| --- | --- |
| Looks free | **backwatervalvemississauga.ca**, sumppumpmississauga.ca, backwatervalvebrampton.ca, backwatervalvehamilton.ca, backwatervalvelondon.ca, backwatervalvevaughan.ca, backwatervalvekitchener.ca, sumppumphamilton.ca, basementfloodingottawa.ca, waterheatermississauga.ca, waterheaterhamilton.ca, waterheaterbrampton.ca, emergencyplumberhamilton.ca, emergencyplumberottawa.ca, frozenpipestoronto.ca |
| Taken | backwatervalvetoronto.ca and .com, backwatervalveottawa.ca, sumppumptoronto.ca, basementfloodingtoronto.ca, waterheatertoronto.ca, waterheaterottawa.ca, tanklesswaterheatertoronto.ca, emergencyplumbertoronto.ca, emergencyplumbermississauga.ca, drainrepairtoronto.ca |

waterheatertoronto.com is also taken, but it was listed for sale at $100.

A .ca domain needs to meet CIRA's Canadian presence requirements. An Ontario resident or a Canadian company qualifies.

## What the site says, and why

- **Two rebate programs, explained properly.** Peel Region pays 60% of a valve on the sanitary pipe, up to $1,500. Apply after the City inspection passes, and only for valves installed after July 16, 2024. The City of Mississauga pays up to $7,500 for storm-side work, including up to $6,000 for a sump pump. The City has required pre-approval *before* work since February 12, 2025. Getting that order wrong is the most common way people lose a rebate, so the site and the call agent both stress it.
- **Permits.** Every backwater valve needs a City building permit: apply in ePlans, pay a $50 fee, and it's usually issued in about three business days. An inspection follows the install.
- **Licensing.** Plumbing is a compulsory trade in Ontario. The people doing the work need a Certificate of Qualification, or must be registered apprentices. In call mode, every page names the partner company, its plumber and the certificate number, and links to the Skilled Trades Ontario public register.
- **Not the City or the Region.** Peel says it doesn't endorse contractors, and it warns residents about companies that claim to work on its behalf. The site and the agent both say plainly that they're independent. Implying an affiliation you don't have is exactly what consumer protection law targets.
- **Safety numbers.** For gas, Enbridge Gas at 1-866-763-5427 or 911. For water near electrical equipment, Alectra Utilities at 1-833-253-2872. For flooded streets, 311. For sanitary sewer backups, Peel's emergency request form.
- **Privacy.** The policy is written for PIPEDA: what's collected and why, consent, access within 30 days, a notice that call data may be processed in the US, and where to complain. The agent discloses the AI and the recording in its first sentence. It only answers calls and never calls, texts or emails anyone, which keeps it clear of CASL.
- **No phone number without a partner.** Ontario has no rule like Texas's "licensed plumber before you advertise". The site still won't show a number until a licensed company has agreed to take the calls, because each caller has water in their basement.
- **No Google Business Profile.** Google lists lead generation companies as ineligible. The site can only rank in the regular results, below the map pack and the ads. Judge the pilot on organic positions.
- **Not legal advice.** Have an Ontario lawyer look over the referral agreement with the partner.

## Launch checklist

1. **Register** backwatervalvemississauga.ca, and check that WHOIS privacy is on.
2. **Fill in `operator`** (your name or company, and a contact email) in `sites/mississauga-backwater-valve/site.json`.
3. **Production build:**

   ```bash
   npm run sites:build -- mississauga-backwater-valve --production
   ```

   It refuses to build while anything is missing or still a placeholder, and lists what to fix. Output: `microsites/dist/backwatervalvemississauga.ca/`.
4. **Deploy to Cloudflare Pages.** It's free. Create one Pages project per site.
   - Dashboard: Workers & Pages → Create → Pages → Upload assets, then upload that folder.
   - Or from the command line: `npx wrangler pages deploy microsites/dist/backwatervalvemississauga.ca --project-name mississauga-backwater-valve`

   Then add the domain under the project's Custom domains. The `_headers` file adds security headers, and `404.html` serves missing pages.
5. **Search Console.** Add a Domain property (verified with a DNS TXT record) and submit `https://backwatervalvemississauga.ca/sitemap.xml`.
6. **Analytics.** Turn on Cloudflare Web Analytics for the Pages project. It's cookieless, which matches the privacy policy.
7. **Sign a partner.** Choose a Mississauga plumbing company that installs backwater valves and sump pumps and knows the rebate paperwork. Before signing:
   - check their plumbers on the Skilled Trades Ontario public register
   - ask for proof of liability insurance and a WSIB clearance certificate

   One easy pitch: send them the pilot's calls free for the first 60 to 90 days, so you both learn what a lead is worth. Put in writing:
   - who does the work
   - permission to show their name and certificate on the site
   - how leads reach them
   - what they'll pay once it works (per qualified call, or a monthly rent)
8. **Tracking number.** Buy one local number for this site in Twilio (905, 289 or 365) and import it into ElevenLabs. Point it at the call desk agent. Update the agent's "Line details" with the partner. Full steps: [voice-agent/README.md](voice-agent/README.md).
9. **Switch to call mode.** Add `partner` and `phone` to `site.json`, run the production build again and redeploy.

## Measuring the pilot

Write down your go or no-go thresholds before launch so the numbers decide, not hope. Demand here follows the weather: searches and calls jump after heavy rain, so compare like seasons.

- **Month 1: indexing.** Are all 7 public pages indexed? Check Search Console under Pages.
- **Month 3: ranking.** For the target queries (backwater valve mississauga, backwater valve rebate mississauga, sump pump installation mississauga, basement flooding mississauga), look at impressions, average position and clicks. Are they trending up? If impressions are still close to zero, improve the content or earn a few genuine local links before cloning anything.
- **Month 6: money.** Track:
  - calls per month on the site's number (ElevenLabs conversations, filtered by the number dialled)
  - the share scored **Qualified lead**
  - how many jobs the partner closed

  That's what a partner pays for.

## Scaling across Ontario without tripping Google's spam rules

Google's spam policies name this pattern as doorway abuse: "having multiple domain names or pages targeted at specific regions or cities that funnel users to one page". This niche gives you a clean way to make every site genuinely different, because each city runs its own permits and rebates:

| City | Program | Notes |
| --- | --- | --- |
| Brampton | Same Peel Region valve rebate | Its own building permits. Research its city programs. |
| Toronto | Subsidy up to $6,650 per home since May 2026 | The obvious domains are taken. |
| Hamilton | Protective Plumbing Program: grant up to $2,000, plus a loan | |
| Ottawa | Residential Protective Plumbing Program: up to $1,000–$3,000 per device | |
| Windsor | Its own subsidy program | |
| London | Its own program | |

Rules for each new site:

- **Its own research and sources.** Copy the method, not the words.
- **No links between sites.** The build enforces this.
- **Its own local partner,** named on that site.

Also, this repo is **public**. Anyone can see every site in it and who runs them. Before you add a second site, move `microsites/` into a private repository.

## How the builder works

```bash
npm run sites:build                     # preview every site       -> microsites/dist/preview/<domain>/
npm run sites:build -- <slug> --live    # preview call mode with a sample phone number and partner
npm run sites:build -- <slug> --production   # strict build to publish -> microsites/dist/<domain>/
npm run sites:test                      # 14 tests on the rules below
```

There are no dependencies: it needs only Node 20+. Preview builds are marked `noindex` and show a ribbon. Production builds refuse:

- sample or placeholder values
- missing operator details
- a phone number without a partner
- 555-01xx numbers
- facts last reviewed more than a year ago

Every build fails on:

- a broken internal link or anchor
- a page without exactly one `<h1>`
- a `tel:` link to any number other than the tracking number or the listed safety numbers
- any link to another site in `sites/`

### Layout

```
microsites/
  build.mjs             command line
  lib/build.mjs         renderer and checks
  lib/styles.css        shared stylesheet, inlined into every page
  sites/<slug>/
    site.json           domain, brand, operator, partner, phone, pages
    pages/*.html        page bodies, written for this site only
  voice-agent/          ElevenLabs agent prompt, settings and tests
  test/                 node:test suite
```

### `site.json`

| Field | Meaning |
| --- | --- |
| `domain`, `brand`, `service`, `trade` | The basics. `trade` defaults to "plumbing" and appears in the "not a plumbing company" disclosure. |
| `city`, `region`, `regionName`, `locale` | For example Mississauga, ON, Ontario, `en-CA`. The locale sets the page language and date format. |
| `lastReviewed` | The date the facts on the pages were last checked. It shows on every page. Production refuses dates over a year old. |
| `operator.name`, `operator.email` | Who runs the site. Required to publish. |
| `partner` | `null` keeps guide mode. For call mode: `{ "company": "...", "description": "a licensed plumbing company", "license": { "label": "Licensed plumber", "holder": "First Last", "credential": "Certificate of Qualification", "number": "..." } }`. |
| `phone` | The tracking number in E.164 form, like `+19055550123`. Only allowed together with `partner`. |
| `regulator` | Where readers can check the licence: `name`, `statement`, `url`, and optionally `address` and `phone`. |
| `notAffiliatedWith` | Who the footer says you're not affiliated with, for example the City and the Region. |
| `safetyPhones` | The only numbers a page may link besides the tracking number: N11 codes like 911 or 311, and E.164 numbers. |
| `retentionDays` | How long call recordings are kept. It's quoted in the privacy policy, so match it in ElevenLabs. |
| `theme` | Optional CSS variable overrides, for example `{ "light": { "--accent": "#0b5cad" }, "dark": { "--accent": "#5aa2ec" } }`. |
| `pages[]` | `file`, `path`, `title`, `description` and `nav` or `footer` labels. `role` can be `home`, `about`, `privacy`, `terms` or `notFound`. Optional `guide` and `live` objects override any of these per mode. |

### Page syntax

| Syntax | Meaning |
| --- | --- |
| `{{brand}}`, `{{city}}`, `{{lastReviewed}}` … | Escaped values from `site.json`. |
| `{{phone}}`, `{{partnerCompany}}`, `{{licenseNumber}}` … | Call mode only. They fail the build in guide mode unless they're wrapped in `<!-- if:live -->`. |
| `[[cta]]`, `[[call-link]]`, `[[license]]` | Call-mode components: the call button with its disclosure, an inline number, and the licence statement. |
| `[[disclosure]]` | The referral disclosure in call mode, or the "independent guide" note in guide mode. |
| `<!-- if:live --> … <!-- /if:live -->`, `<!-- if:guide --> … <!-- /if:guide -->` | Content for one mode only. |

## Sources (checked 2026-11-20)

- Region of Peel, backwater valve rebate: https://peelregion.ca/water/pipes-downspouts/backwater-valve-rebate
- Region of Peel, basement flooding: https://peelregion.ca/water/flooding-leaks/basement-flooding
- City of Mississauga, basement flooding prevention rebate: https://www.mississauga.ca/services-and-programs/home-and-yard/stormwater/apply-for-a-basement-flooding-prevention-rebate/
- City of Mississauga, backwater valve permits: https://www.mississauga.ca/services-and-programs/building-and-renovating/building-permits/when-a-building-permit-is-required/backwater-valve-permits/
- Skilled Trades Ontario, plumber and public register: https://skilledtradesontario.ca/trade-information/plumber and https://skilledtradesontario.ca/public-register/
- Enbridge Gas, emergency contact: https://www.enbridgegas.com/contact-us/
- Alectra Utilities, report an electrical emergency: https://alectrautilities.com/Report-Outage
- Electrical Safety Authority, flood safety: https://esasafe.com/safety/storm-safety/flood-safety/
- City of Toronto, basement flooding protection subsidy: https://www.toronto.ca/services-payments/water-environment/basement-flooding-protection-subsidy-program/
- City of Hamilton, Protective Plumbing Program: https://hamilton.ca/home-neighbourhood/house-home/basement-flooding/protective-plumbing-program
- City of Ottawa, Residential Protective Plumbing Program: https://ottawa.ca/en/living-ottawa/drinking-water-stormwater-and-wastewater/wastewater-and-sewers/basement-flooding/flooding-rebates-and-grant/residential-protective-plumbing-program
- Government of Canada, rented water heaters in Ontario: https://ised-isde.canada.ca/site/search-research-database/en/node/14502
- Google Business Profile eligibility: https://support.google.com/business/answer/13763036
- Google spam policies, doorways: https://developers.google.com/search/docs/essentials/spam-policies#doorways
