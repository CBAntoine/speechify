// How agencies actually land local-business clients, from practitioner
// reports and agency surveys (Nov 2026 research; see docs/research.md).
// Figures come from search excerpts of the linked pages: directional, not benchmarks.

export interface Playbook {
  id: string;
  title: string;
  tag: string;
  why: string;
  steps: string[];
  script?: string;
  action: { label: string; href: string };
  sources: { text: string; url: string }[];
  /** A play from the owner's own notes rather than research: shown as such, with no sources. */
  own?: boolean;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: "referrals",
    title: "Referral engine",
    tag: "Where most clients come from",
    why: "In agency surveys, referrals are the top source of new clients by a wide margin. Practitioners still say their first clients came from outbound, so use outbound to start and referrals to grow.",
    steps: [
      "After a client's first good month, ask for one introduction. Make it a task so you don't forget.",
      "Build a partner list: web designers, accountants, business coaches, local networking groups.",
      "Offer something for each intro that signs (a month off, a gift card, a cash bonus).",
    ],
    script: "Quick favor: who's one other business owner you know who'd want more booked appointments? I'll take great care of them, and if they sign, your next month is on us.",
    action: { label: "Have the Chief of Staff set referral asks", href: "/agents?agent=ops&goal=" + encodeURIComponent("Create a task to ask each client in Won for one referral, due this week") },
    sources: [
      { text: "SparkToro 2025: 66% name client referrals as their top source", url: "https://sparktoro.com/blog/digital-agency-new-business-still-a-concern-referrals-still-rule-for-lead-gen-and-are-sales-pipelines-finally-recovering/" },
      { text: "AgencyAnalytics 2026 (n=494): 85% cite referrals", url: "https://agencyanalytics.com/blog/agency-benchmarks-2026-ai-search" },
      { text: "~$208k in a year traced to one BNI chapter", url: "https://metacast.app/podcast/web-design-business-with-josh-hall/7rGGtcT2/338---how-mike-generated-208-000-from-his-bni-networking-group-in-one-year/ke3GNion" },
    ],
  },
  {
    id: "gap-email",
    title: "Gap-first cold email",
    tag: "The #2 source, and the fastest to start",
    why: "Cold outbound is the second most-credited channel. Across one large sending platform the average reply rate was about 3.4%, the top 10% of senders got 10.7% or more, and 42% of replies came after the first email, so follow-ups matter.",
    steps: [
      "Pick one niche and one city. Search them in Find Clients.",
      "Keep only businesses with a gap you can see for yourself (no booking, no website, few reviews).",
      "Open with that one observation, connect it to lost customers, offer something small and free.",
      "Keep it under about 80–120 words with one yes/no question. Follow up on days 3, 7 and 14.",
    ],
    script: "Hi Dana, I tried to request a roof inspection on your site tonight and there's no way to do it online, only a phone number. After-hours visitors usually call the next roofer instead. I set up online booking for roofers; want me to send a 2-minute video of what it'd look like on your site?",
    action: { label: "Find businesses with gaps", href: "/prospects" },
    sources: [
      { text: "Instantly 2026 benchmark: 3.43% average reply, top 10% at 10.7%+", url: "https://instantly.ai/cold-email-benchmark-report-2026" },
      { text: "Observation → pain → proof → call to action", url: "https://www.lemlist.com/blog/how-to-write-a-cold-email-that-sells-smma" },
      { text: "Keep it under ~80 words", url: "https://prospeo.io/s/cold-email-for-smma" },
    ],
  },
  {
    id: "website-ai-guide",
    title: "AI website guide, free trial",
    tag: "An offer that sells itself in the demo",
    why: "Put a chat and voice guide on a local business's website that answers visitors and passes the owner their name and number. Pitch more website leads, not AI. Planning numbers to check against your own trials: about 5% of visitors talk to the guide and 2.5% leave their details. Need-to-have businesses (HVAC, plumbing, roofing, auto repair) convert best; want-to-have ones (med spas) least.",
    steps: [
      "Pick need-to-have businesses with real traffic: check Semrush or Similarweb, then ask to see their Google Analytics. Enter the visitors on the lead to get the leads and the price ($300 a month for small sites, up to $4,000+).",
      "Open the lead and press Build AI guide: it reads their site into a knowledge base and builds the guide and a demo page, a one-page copy of their site with the guide above the fold. If the site blocks automated reading, paste the details instead.",
      "Test the five demo questions before you show it, fix weak answers, and print the demo page with its link highlighted.",
      "Write the pitch (email, text and call script), then offer it free on their site for 2 to 4 weeks, no credit card.",
      "Start the trial, send them the two lines of embed code, and send the leads report after a week. At the end, move them to the retainer, plus a $1,000 to $5,000 setup fee for big sites (or $200 an hour).",
      "Every month, load the report and add answers to the questions it missed: 1 to 2 hours for small clients, more for big ones.",
    ],
    script: "I help local businesses get 10 to 20 percent more leads from the traffic they already have. I built a guide for your website from your own pages: ask it what your customers ask. I'll put it on your site free for four weeks, no credit card, and you'll see every lead it captures.",
    action: { label: "Open a lead to build one", href: "/pipeline" },
    sources: [],
    own: true,
  },
  {
    id: "sample-ads",
    title: "Free sample ads",
    tag: "Give before you ask",
    why: "A campaign made for one business is hard to ignore and shows your skill instantly. Spec work converts at low rates, so keep it to minutes per prospect, which is what Ad Studio is for.",
    steps: [
      "Open a hot lead and build sample ads in Ad Studio (about a minute).",
      "Download the feed creative or screenshot the preview.",
      "Send it with your first email or DM: “I made this for you.”",
      "Offer to run it for a short paid pilot instead of a long contract.",
    ],
    action: { label: "Open Ad Studio", href: "/ads" },
    sources: [
      { text: "Spec redesigns: 47 analysed → 12 deployed → 1 sale in week one", url: "https://dev.to/ryancwynar/building-an-ai-powered-lead-gen-machine-from-ugly-websites-to-paying-clients-474a" },
    ],
  },
  {
    id: "video-audit",
    title: "45-second video audit",
    tag: "Higher replies, more effort",
    why: "One agency owner reports about 15% replies with personal screen recordings versus 3–8% for plain text. Another got more replies after switching away from per-prospect videos, so test it against your plain emails.",
    steps: [
      "Open the lead's Outreach tab and pick “Video audit” for a script built from its audit.",
      "Record 45 seconds on their site or listing: the two biggest gaps and what fixing them means.",
      "Send it with one line and ask for a 15-minute call.",
    ],
    action: { label: "Go to your pipeline", href: "/pipeline" },
    sources: [
      { text: "15% reply rate with personal video audits", url: "https://www.skool.com/agencyworld/how-im-getting-15-reply-rates-with-loom-outreach-exact-breakdown" },
      { text: "Counterpoint: replies went up after dropping per-prospect videos", url: "https://www.skool.com/lead-gen/i-stopped-sending-looms-replies-went-up" },
    ],
  },
  {
    id: "advertisers",
    title: "Target businesses already running ads",
    tag: "They already have a budget",
    why: "A business with an ad pixel or active ads is already paying for customers. Pitch better results. One without ads gets “your competitors are advertising and you're not.”",
    steps: [
      "In Find Clients, filter “Already runs ads” (pixel found on their site).",
      "Open the business and click “Are they running Meta ads?” to see their live ads.",
      "Lead with one specific improvement to an ad they're running now.",
    ],
    action: { label: "Find advertisers", href: "/prospects" },
    sources: [
      { text: "Using the Meta Ad Library to find clients", url: "https://omnionlinestrategies.com/blog/marketing-agencies-meta-ad-library-new-clients" },
      { text: "Facebook Ads Library guide", url: "https://neilpatel.com/blog/facebook-ads-library/" },
    ],
  },
  {
    id: "no-website",
    title: "No-website and weak-site sweep",
    tag: "The classic local pitch",
    why: "In one 100-business test, about 30% of map listings had no website. Franchises and listings that link elsewhere show up as false positives, so confirm before you pitch.",
    steps: [
      "Search a niche and filter “No website” or “Not mobile-friendly”.",
      "Check with a quick web search that the site really doesn't exist.",
      "Pitch a simple site that books jobs, with a sample built in Ad Studio's landing copy.",
    ],
    action: { label: "Run a sweep", href: "/prospects" },
    sources: [
      { text: "Verification lesson from a no-website lead pipeline", url: "https://www.skool.com/ai-automation-society/starting-a-cold-calling-challenge-and-a-verification-lesson-from-the-lead-pipeline" },
      { text: "Google Maps vs Yelp vs Apollo for local data", url: "https://dev.to/alexberman1/google-maps-vs-yelp-vs-apollo-which-has-better-b2b-data-2n43" },
    ],
  },
  {
    id: "reviews",
    title: "Review gap",
    tag: "Easy to see, easy to sell",
    why: "Fewer reviews than nearby competitors costs map rankings and clicks. It's a visible, specific opener.",
    steps: [
      "Add a Google Places key so search returns ratings and review counts.",
      "Filter “Few reviews” and compare with the top 3 competitors in the same search.",
      "Offer automated review requests after every visit or job.",
    ],
    script: "I noticed Brightside has 41 Google reviews while the top two dentists near you have over 300. That gap decides who gets the call. We set up automatic review requests after each visit. Want to see how it works?",
    action: { label: "Find review gaps", href: "/prospects" },
    sources: [{ text: "Weak profiles make better outreach openers", url: "https://gaptro-landio-preview.pages.dev/blog/weak-profiles-better-outreach" }],
  },
  {
    id: "missed-calls",
    title: "Missed-call mystery shop",
    tag: "Proof they lose leads",
    why: "Call after hours or submit their form and time the response. A missed call or slow reply is concrete proof. Missed-call text-back is a cheap entry offer; one seller who door-knocked HVAC firms found less pain than expected, so check the niche first.",
    steps: [
      "Call the business after hours and submit its website form.",
      "Note what happened: voicemail, no reply, reply time.",
      "Pitch missed-call text-back first; upsell an AI receptionist later.",
    ],
    action: { label: "Pick leads to test", href: "/pipeline" },
    sources: [
      { text: "Land your first AI-agency clients", url: "https://growwstacks.com/blog/how-to-land-first-5-ai-agency-clients/" },
      { text: "Reality check from door-knocking HVAC firms", url: "https://www.skool.com/the-ai-advantage/anyone-actually-landed-an-hvac-ac-client-here-reality-checking-what-i-found-on-the-ground" },
    ],
  },
  {
    id: "cold-calls",
    title: "Cold-call niche test",
    tag: "Find your niche in a week",
    why: "One agency built a list of 30–50 businesses per niche, struck out in two niches, and closed a first client after three days of calls in the third. Test fast, switch fast.",
    steps: [
      "Find 40 businesses in one niche and add them to the pipeline.",
      "Open the Outreach tab, pick “Call script” and write one from each lead's audit.",
      "Make the calls in one block. Log every answer in notes. Switch niches after 50 calls with no interest.",
    ],
    action: { label: "Build a call list", href: "/prospects" },
    sources: [{ text: "First client after 3 days of cold calling", url: "https://www.skool.com/gohighlevel/closed-my-first-client-after-3-days-of-cold-calling" }],
  },
  {
    id: "hiring",
    title: "Hiring signal",
    tag: "They're about to spend",
    why: "A business posting a marketing job has a budget and a problem today. Offer an agency as the faster, cheaper option. Ignore reposts by staffing agencies.",
    steps: [
      "Search job boards for “marketing coordinator” or “social media manager” plus your city.",
      "Add the real businesses (not staffing firms) as leads, with the job link in notes.",
      "Pitch: “Before you hire, see what we'd do in the first 30 days.”",
    ],
    action: { label: "Add a lead", href: "/pipeline" },
    sources: [{ text: "Hiring as a buying-intent signal", url: "https://www.lemlist.com/blog/hiring-as-buying-intent-signal" }],
  },
  {
    id: "new-businesses",
    title: "Brand-new businesses",
    tag: "Before anyone else calls",
    why: "New businesses need a website, a Google Business Profile and first customers. Some states publish new registrations: Kentucky daily, North Dakota as a $40/month list.",
    steps: [
      "Check your state's business registration data or new-business feeds.",
      "Filter to local, customer-facing businesses in your niches.",
      "Offer a launch package: site, Google profile, first 30 days of ads.",
    ],
    action: { label: "Add leads", href: "/pipeline" },
    sources: [
      { text: "Kentucky new-business file descriptions", url: "https://sos.ky.gov/bus/Pages/File-Descriptions.aspx" },
      { text: "North Dakota data list requests", url: "https://www.sos.nd.gov/services/data-list-requests" },
    ],
  },
  {
    id: "entry-offers",
    title: "Low-risk entry offers",
    tag: "Make yes easy",
    why: "Local owners want fast, visible revenue. Small first steps close faster: a discounted local tier, a pay-per-lead pilot, missed-call text-back, or reactivating their old customer list.",
    steps: [
      "Put one entry offer in Settings under your core offer.",
      "Use it as the call to action in follow-ups, not the first email.",
      "Graduate pilots to a monthly retainer once results show up.",
    ],
    action: { label: "Edit your offer", href: "/settings" },
    sources: [
      { text: "How to get SMMA clients: pilots and local tiers", url: "https://instantly.ai/blog/how-to-get-smma-clients/" },
      { text: "Database reactivation deal: $5,800 for 3 months, then $1,500/mo", url: "https://www.skool.com/gohighlevel/dr-client-using-robbs-closing-script" },
    ],
  },
  {
    id: "communities",
    title: "Communities and speaking",
    tag: "Slow, compounding",
    why: "Speaking moved up to the 4th most-credited channel in one survey. Post where owners gather, not where freelancers do, and read each group's rules: many ban self-promotion.",
    steps: [
      "Join 2–3 groups where your niche's owners talk shop (local business groups, niche associations).",
      "Answer questions with specific, useful fixes from your audits. No pitching.",
      "Offer a short talk at a chamber, BNI or association meeting.",
    ],
    action: { label: "See your niches", href: "/prospects" },
    sources: [
      { text: "Make money in Facebook groups (without spamming)", url: "https://copyhackers.com/2022/04/make-money-in-facebook-groups/" },
      { text: "Where SEOs get their clients (SEOFOMO survey)", url: "https://www.searchenginejournal.com/survey-shows-where-seos-get-their-clients/525399/" },
    ],
  },
];

/** What agencies complain about in all-in-one agency platforms, and how
 * Rainmaker answers each. Sources: G2, Capterra, Software Advice, HighLevel's
 * own feature-request board (search excerpts, Nov 2026). */
export const COMPLAINTS: { complaint: string; answer: string; url: string }[] = [
  { complaint: "Steep learning curve; key options feel hidden (the most common G2 complaint).", answer: "Seven screens with plain names. Each has one main action, and agents do the multi-step work for you.", url: "https://www.g2.com/products/highlevel/reviews?qs=pros-and-cons" },
  { complaint: "“It does not bring you clients. You bring clients to it.”", answer: "Finding clients is the core: map search, website audits, opportunity scores and sourced playbooks.", url: "https://autogencrm.com/gohighlevel-review/" },
  { complaint: "Everything costs extra on top of the subscription; wallet auto-recharges.", answer: "No wallet and no markup. You pay Claude and Google directly, every agent run has a hard dollar cap, and each run shows what it cost.", url: "https://www.capterra.com/p/177156/HighLevel/reviews/" },
  { complaint: "AI add-ons are expensive to resell and unreliable.", answer: "Claude is built into every screen, and nothing an agent writes goes out without your approval.", url: "https://ideas.gohighlevel.com/conversation-ai/p/how-can-we-sell-this-when-its-so-expensive-for-the-customer" },
  { complaint: "Bugs, slow automations and monthly downtime.", answer: "A small codebase you own and can run anywhere. With Managed Agents, the agent loop runs on Anthropic's infrastructure.", url: "https://www.g2.com/discussions/unstable-workflows-and-random-glitches-slow-down-client-work-and-force-me-to-recheck-everything" },
  { complaint: "SMS registration that takes weeks; emails landing in junk.", answer: "Email goes from your own domain (Resend) or your own mail app. Texts open in your phone's Messages app. No shared sending pool.", url: "https://ideas.gohighlevel.com/lcemailsystem/p/lc-emails-ending-up-in-junk" },
];
