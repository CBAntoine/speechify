# Microsites: rank-and-rent pilot

This folder runs the seven-step plan:

1. Pick an urgent, high-ticket niche.
2. Pilot one sub-niche in one city.
3. Register an exact-match domain.
4. Build a flat HTML site.
5. Keep sites isolated.
6. Add a tracking number with AI call qualification.
7. Let the site age, then scale.

It holds the pilot site, a small builder for adding more, and the AI agent that answers calls. The Neon Atlas app elsewhere in this repo doesn't use any of it.

## Where things stand (checked 2026-11-20)

| Step | Status |
| --- | --- |
| 1. Niche | Plumbing. Water heaters are urgent, high-ticket and served by many small local companies. |
| 2. Pilot | **Water heater replacement in Houston, TX.** One sub-niche, one city. |
| 3. Domain | **houstonwaterheaterreplacement.com** was available. Namecheap: $12.08 the first year, $19.98 a year after. **Not registered yet.** |
| 4. Site | Built: 7 pages of static HTML, about 105 KB in total, with no JavaScript. Not deployed yet. |
| 5. Isolation | Enforced by the build. A site that links to another site in `sites/` fails to build. |
| 6. Calls | AI agent created in ElevenLabs and tested (12 of 12 runs passing). **No phone number yet, on purpose.** See [voice-agent/README.md](voice-agent/README.md). |
| 7. Age and scale | The clock starts when the site goes live. |

### Domains checked on 2026-11-20

Taken: waterheaterhoustontx.com (registered in 2026: the example in the plan), waterheaterhouston.com, houstonwaterheater.com, houstonwaterheaters.com, houstonwaterheaterrepair.com, waterheaterrepairhouston.com, waterheaterrepairhoustontx.com and houstontxwaterheater.com.

Available:

| Use | Domains |
| --- | --- |
| Houston | **houstonwaterheaterreplacement.com**, waterheaterreplacementhoustontx.com, waterheaterhoustontexas.com, tanklesswaterheaterhoustontx.com |
| Suburbs, for later | waterheaterpearlandtx.com, waterheatercypresstx.com, waterheaterthewoodlandstx.com, waterheaterhumbletx.com, waterheaterleaguecitytx.com, waterheatertomballtx.com, waterheatermissouricitytx.com, waterheaterbaytowntx.com, waterheaterconroetx.com |

Taken in the suburbs: Katy, Sugar Land, Spring, Friendswood, Pasadena, Richmond and Bellaire, each in the `waterheater<city>tx.com` pattern.

Availability changes daily, so check again at the registrar before you buy.

## Texas rules that change the plan

These aren't in the video. They decide when the site can show a phone number.

- **You can't advertise plumbing until a Responsible Master Plumber is secured.** Texas Occupations Code §1301.351(a-2): "A person that advertises or otherwise offers to perform or provide plumbing must secure the services of a responsible master plumber." State Board of Plumbing Examiners (TSBPE) Rule 367.9 says the same. That's why the site has two modes:
  - **Guide mode** (now): a plain-English guide with no phone number and no call buttons. It's safe to publish while the domain ages and you look for a partner.
  - **Call mode**: switched on by adding the partner to `site.json`. Every page then shows the tracking number and a license statement:
    - the company name
    - the RMP's name and license number
    - "Regulated by the Texas State Board of Plumbing Examiners", with the board's address, phone and website

    Texas requires those license details on plumbing proposals and invoices, and showing them on the site is the cautious reading of the advertising rule.
- **City of Houston permits.** Every water heater replacement needs a plumbing permit pulled by a master plumber registered with the City, plus an inspection. The partner has to be registered with Houston, not just licensed by the state.
- **No Google Business Profile.** Google lists "lead generation agents or companies" as ineligible. The site can only rank in the regular results, below the map pack and the ads. Judge the pilot on organic positions.
- **Not legal advice.** Have a Texas attorney look over the referral agreement with the partner: who the RMP of record is, how you're paid per lead, and how the site names them.

## Launch checklist

1. **Register the domain**, with WHOIS privacy turned on.
2. **Fill in `operator`** (your name or LLC, and a contact email) in `sites/houston-water-heater-replacement/site.json`.
3. **Production build:**

   ```bash
   npm run sites:build -- houston-water-heater-replacement --production
   ```

   It refuses to build while anything is missing or still a placeholder, and lists what to fix. Output: `microsites/dist/houstonwaterheaterreplacement.com/`.
4. **Deploy to Cloudflare Pages.** It's free. Create one Pages project per site.
   - Dashboard: Workers & Pages → Create → Pages → Upload assets, then upload that folder.
   - Or from the command line: `npx wrangler pages deploy microsites/dist/houstonwaterheaterreplacement.com --project-name houston-water-heater-replacement`

   Then add the domain under the project's Custom domains. The `_headers` file adds security headers, and `404.html` serves missing pages.
5. **Search Console.** Add a Domain property (verified with a DNS TXT record) and submit `https://houstonwaterheaterreplacement.com/sitemap.xml`.
6. **Analytics.** Turn on Cloudflare Web Analytics for the Pages project. It's cookieless, which matches the privacy policy, and the site's security headers already allow it.
7. **Sign a partner.** Find a licensed plumbing company whose master plumber is registered with the City of Houston. Check them at tsbpe.texas.gov. One easy pitch: send them the pilot's calls free for the first 60 to 90 days, so you both learn what a lead is worth. Put in writing:
   - that they're the RMP of record
   - permission to show their name and license on the site
   - how leads reach them
   - what they'll pay once it works (per qualified call, or a monthly rent)
8. **Tracking number.** Buy one local number for this site in Twilio and import it into ElevenLabs. Point it at the call desk agent. Update the agent's "Line details" with the partner. Full steps: [voice-agent/README.md](voice-agent/README.md).
9. **Switch to call mode.** Add `partner` and `phone` to `site.json`, run the production build again and redeploy.

## Measuring the pilot

Write down your go or no-go thresholds before launch so the numbers decide, not hope.

- **Month 1: indexing.** Are all 6 pages indexed? Check Search Console under Pages. If not, look at what Google reports for each URL.
- **Month 3: ranking.** For the target queries (water heater replacement houston, tankless water heater installation houston, water heater leaking), look at impressions, average position and clicks. Are they trending up? This is usually when you can tell whether a site will work. If impressions are still close to zero, improve the content or earn a few genuine local links before cloning anything.
- **Month 6: money.** Track:
  - calls per month on the site's number (ElevenLabs conversations, filtered by the number dialed)
  - the share scored **Qualified lead**
  - how many jobs the partner closed

  That's what a partner pays for.

## Scaling (step 7) without tripping Google's spam rules

Google's spam policies name this pattern as doorway abuse: "having multiple domain names or pages targeted at specific regions or cities that funnel users to one page". A network of near-identical city sites that all forward to one phone line fits that description. Each new site has to stand on its own:

- **Its own research.** Each city has its own permit office, fees and rules, and Houston's don't apply in Pearland or Katy. Check them and cite them, just as this site does.
- **Its own pages.** The builder only shares the layout and stylesheet. Content lives in each site's `pages/` folder, so cloning means writing.
- **No links between sites.** The build enforces this.
- **Its own partner.** Ideally a local company in each area, named on that site.

Also, this repo is **public**. Anyone can see every site in it and who runs them. Before you add a second site, move `microsites/` into a private repository.

## How the builder works

```bash
npm run sites:build                     # preview every site       -> microsites/dist/preview/<domain>/
npm run sites:build -- <slug> --live    # preview call mode with a sample phone number and partner
npm run sites:build -- <slug> --production   # strict build to publish -> microsites/dist/<domain>/
npm run sites:test                      # 13 tests on the rules below
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
| `domain`, `brand`, `service`, `city`, `state`, `stateName` | The basics. |
| `lastReviewed` | The date the facts on the pages were last checked. It shows on every page. Production refuses dates over a year old. |
| `operator.name`, `operator.email` | Who runs the site. Required to publish. |
| `partner` | `null` keeps guide mode. Set `{ "company": "...", "license": { "holder": "First Last", "number": "M-12345", "label": "Responsible Master Plumber" } }` for call mode. |
| `phone` | The tracking number in E.164 form, like `+17135550123`. Only allowed together with `partner`. |
| `regulator` | The licensing board named in the license statement. |
| `safetyPhones` | The only numbers a page may link besides the tracking number: 911 and the gas-leak lines. |
| `retentionDays` | How long call recordings are kept. It's quoted in the privacy policy, so match it in ElevenLabs. |
| `theme` | Optional CSS variable overrides, for example `{ "light": { "--accent": "#0b5cad" }, "dark": { "--accent": "#5aa2ec" } }`. |
| `pages[]` | `file`, `path`, `title`, `description` and `nav` or `footer` labels. `role` can be `home`, `about`, `privacy`, `terms` or `notFound`. Optional `guide` and `live` objects override any of these per mode. |

### Page syntax

| Syntax | Meaning |
| --- | --- |
| `{{brand}}`, `{{city}}`, `{{lastReviewed}}` … | Escaped values from `site.json`. |
| `{{phone}}`, `{{partnerCompany}}`, `{{licenseNumber}}` … | Call mode only. They fail the build in guide mode unless they're wrapped in `<!-- if:live -->`. |
| `[[cta]]`, `[[call-link]]`, `[[license]]` | Call-mode components: the call button with its disclosure, an inline number, and the license statement. |
| `[[disclosure]]` | The referral disclosure in call mode, or the "independent guide" note in guide mode. |
| `<!-- if:live --> … <!-- /if:live -->`, `<!-- if:guide --> … <!-- /if:guide -->` | Content for one mode only. |

## Sources (checked 2026-11-20)

- Houston Permitting Center, Water Heater permit (HPWCODE1101): https://www.houstonpermittingcenter.org/hpwcode1101
- Texas Occupations Code ch. 1301 (§1301.351(a-2)): https://statutes.capitol.texas.gov/Docs/OC/htm/OC.1301.htm
- TSBPE Administrative Rules, March 2026 (Rule 367.9 and the proposal/invoice requirements): https://tsbpe.texas.gov/wp-content/uploads/documents/TSBPE_AdministrativeRules_March2026.pdf
- TSBPE consumer information: https://tsbpe.texas.gov/consumer-information/
- City of Houston, gas leak numbers: https://www.houstontx.gov/ara/utility/important-numbers.html
- U.S. Department of Energy, Energy Saver Guide (water heater life, 120°F): https://www.energy.gov/sites/default/files/2022-08/energy-saver-guide-2022.pdf
- Google Business Profile eligibility: https://support.google.com/business/answer/13763036
- Google spam policies, doorways: https://developers.google.com/search/docs/essentials/spam-policies#doorways
