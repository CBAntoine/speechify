// Niche library: what local businesses in each niche care about, the ad
// offers that tend to work for them, and how to find them on the map.
// Dollar figures are rough planning ranges, not quotes. See docs/research.md.

export interface Niche {
  id: string;
  label: string;
  plural: string;
  /** Lucide icon name used by the UI. */
  icon: string;
  /** Google Places text query, e.g. "dentist". */
  query: string;
  /** OpenStreetMap tag filters, as key=value. */
  osmTags: string[];
  /** Case-insensitive regex on the business name, for niches OSM tags poorly. */
  osmName?: string;
  /** Appointment-based, so online booking matters. */
  booking: boolean;
  /** What one new customer is worth to them (rough). */
  customerValue: string;
  /** What agencies typically charge them per month (rough). */
  retainer: string;
  /** Midpoint used for pipeline value estimates. */
  retainerMid: number;
  painPoints: string[];
  offers: string[];
  angles: string[];
  channels: string[];
  keywords: string[];
  /** A practitioner tip from research, with sources in `evidence`. */
  tip?: string;
  evidence?: { text: string; url: string }[];
}

export const NICHES: Niche[] = [
  {
    id: "dentist",
    label: "Dentist",
    plural: "dentists",
    icon: "ToothbrushSparkles",
    query: "dentist",
    osmTags: ["amenity=dentist", "healthcare=dentist"],
    booking: true,
    customerValue: "$1,000–$3,000+ per new patient over time",
    retainer: "$1,500–$4,000/mo",
    retainerMid: 2500,
    painPoints: [
      "Empty hygiene chairs and last-minute cancellations",
      "High-value cases (implants, Invisalign) are rare and price-shopped",
      "Front desk misses calls during busy hours",
    ],
    offers: [
      "New-patient exam, X-rays and cleaning for one flat price",
      "Free Invisalign or implant consultation with 3D scan",
      "Same-day emergency appointments",
    ],
    angles: ["Gentle care for nervous patients", "Insurance-friendly, clear pricing", "Smile makeover before and after"],
    channels: ["Google Search", "Google Local Services", "Meta (Facebook/Instagram)"],
    keywords: ["dentist near me", "emergency dentist", "teeth cleaning", "dental implants", "invisalign cost"],
  },
  {
    id: "med_spa",
    label: "Med spa",
    plural: "med spas",
    icon: "Sparkles",
    query: "med spa",
    osmTags: ["shop=beauty", "amenity=clinic"],
    osmName: "med ?spa|medspa|aesthetic|botox|laser|injectables|skin clinic",
    booking: true,
    customerValue: "$1,500–$5,000 per client per year",
    retainer: "$1,500–$4,000/mo",
    retainerMid: 2500,
    painPoints: [
      "Leads book once and never come back",
      "Competing on price with the spa down the street",
      "No-shows on consultation slots",
    ],
    offers: [
      "First Botox visit at a set price per unit",
      "Free skin consultation with a treatment plan",
      "Membership: monthly facial plus member pricing",
    ],
    angles: ["Natural-looking results by licensed injectors", "Real client before and after", "Lunch-break treatments"],
    channels: ["Meta (Facebook/Instagram)", "TikTok/Reels", "Google Search"],
    keywords: ["botox near me", "med spa", "lip filler", "laser hair removal", "hydrafacial"],
  },
  {
    id: "roofer",
    label: "Roofer",
    plural: "roofing companies",
    icon: "House",
    query: "roofing contractor",
    osmTags: ["craft=roofer"],
    osmName: "roof",
    booking: false,
    customerValue: "$8,000–$20,000 per replacement job",
    retainer: "$2,000–$5,000/mo",
    retainerMid: 3500,
    painPoints: [
      "Feast or famine: busy after storms, quiet otherwise",
      "Shared leads from lead brokers that five roofers also call",
      "Homeowners don't trust door knockers",
    ],
    offers: [
      "Free roof inspection with drone photos",
      "Storm-damage insurance claim help",
      "Financing from a low monthly payment",
    ],
    angles: ["Local, licensed and insured", "See your roof from above before you decide", "Warranty that outlasts the loan"],
    channels: ["Google Search", "Google Local Services", "Meta (Facebook/Instagram)"],
    keywords: ["roof repair near me", "roof replacement cost", "roofing contractor", "storm damage roof", "roof leak repair"],
  },
  {
    id: "hvac",
    label: "HVAC",
    plural: "HVAC companies",
    icon: "Thermometer",
    query: "HVAC contractor",
    osmTags: ["craft=hvac"],
    osmName: "hvac|heating|air condition|cooling|furnace",
    booking: true,
    customerValue: "$300 per repair call to $8,000–$15,000 per new system",
    retainer: "$2,000–$5,000/mo",
    retainerMid: 3500,
    painPoints: [
      "Seasonal swings in call volume",
      "Missed after-hours emergency calls",
      "Maintenance plans that never get sold",
    ],
    offers: [
      "$89 tune-up with a no-surprise price",
      "Same-day AC repair or the diagnostic is free",
      "New system from a low monthly payment",
    ],
    angles: ["Fast local techs, upfront pricing", "Beat the heat (or cold) before it breaks", "Maintenance club perks"],
    channels: ["Google Search", "Google Local Services", "Meta (Facebook/Instagram)"],
    keywords: ["ac repair near me", "furnace repair", "hvac company", "ac not cooling", "heat pump installation"],
  },
  {
    id: "plumber",
    label: "Plumber",
    plural: "plumbers",
    icon: "Wrench",
    query: "plumber",
    osmTags: ["craft=plumber"],
    osmName: "plumb|rooter|drain",
    booking: true,
    customerValue: "$250–$600 per call, $2,000+ for water heaters and repipes",
    retainer: "$1,500–$4,000/mo",
    retainerMid: 2500,
    painPoints: ["Emergency calls go to whoever answers first", "Low-value calls crowd out big jobs", "Few reviews compared with franchises"],
    offers: ["Flat-rate drain cleaning", "Free water-heater replacement quote", "24/7 emergency line, no overtime fee"],
    angles: ["Answers at 2 a.m.", "Upfront price before we start", "Clean, background-checked techs"],
    channels: ["Google Search", "Google Local Services"],
    keywords: ["plumber near me", "emergency plumber", "water heater replacement", "clogged drain", "leak repair"],
  },
  {
    id: "chiropractor",
    label: "Chiropractor",
    plural: "chiropractors",
    icon: "Activity",
    query: "chiropractor",
    osmTags: ["healthcare=chiropractor", "healthcare:speciality=chiropractic"],
    osmName: "chiropract",
    booking: true,
    customerValue: "$800–$2,500 per patient care plan",
    retainer: "$1,000–$3,000/mo",
    retainerMid: 2000,
    painPoints: ["Patients quit care plans early", "Relying on referrals that dried up", "Insurance changes squeeze margins"],
    offers: ["New-patient exam, X-rays and first adjustment at one price", "Free back-pain screening", "Sciatica relief program"],
    angles: ["Get back to the gym, golf or garden", "Drug-free relief", "Same-week appointments"],
    channels: ["Meta (Facebook/Instagram)", "Google Search"],
    keywords: ["chiropractor near me", "back pain relief", "sciatica treatment", "neck pain doctor"],
  },
  {
    id: "law_pi",
    label: "Personal injury law",
    plural: "personal injury law firms",
    icon: "Scale",
    query: "personal injury lawyer",
    osmTags: ["office=lawyer"],
    osmName: "injury|accident|law|attorney|legal",
    booking: false,
    customerValue: "Thousands to six figures per signed case",
    retainer: "$3,000–$10,000/mo",
    retainerMid: 5000,
    painPoints: ["Very expensive clicks", "Intake team misses after-hours calls", "Big-budget firms dominate TV and billboards"],
    offers: ["Free case review in 15 minutes", "No fee unless we win", "Answers 24/7 by a real person"],
    angles: ["Local trial experience", "Talk to an attorney, not a call center", "Know what your case is worth"],
    channels: ["Google Search", "Google Local Services", "YouTube"],
    keywords: ["car accident lawyer", "personal injury attorney near me", "truck accident lawyer", "slip and fall lawyer"],
  },
  {
    id: "real_estate",
    label: "Real estate agent",
    plural: "real estate agents",
    icon: "KeyRound",
    query: "real estate agent",
    osmTags: ["office=estate_agent", "shop=estate_agent"],
    osmName: "realty|real estate|realtor|homes",
    booking: false,
    customerValue: "Several thousand dollars per closed deal",
    retainer: "$1,000–$3,000/mo",
    retainerMid: 1800,
    painPoints: ["Zillow leads are expensive and shared", "Long, slow follow-up cycles", "Hard to stand out among hundreds of agents"],
    offers: ["Free home value report", "List with us: sold in 30 days or we cut our fee", "First-time buyer workshop"],
    angles: ["Neighborhood expert", "What your home is worth today", "Off-market listings"],
    channels: ["Meta (Facebook/Instagram)", "Google Search", "YouTube"],
    keywords: ["what is my home worth", "realtor near me", "homes for sale", "sell my house fast"],
  },
  {
    id: "gym",
    label: "Gym / fitness studio",
    plural: "gyms and fitness studios",
    icon: "Dumbbell",
    query: "gym",
    osmTags: ["leisure=fitness_centre", "sport=fitness"],
    osmName: "gym|fitness|crossfit|bootcamp|pilates|yoga",
    booking: true,
    customerValue: "$600–$2,000 per member per year",
    retainer: "$1,000–$3,000/mo",
    retainerMid: 1800,
    painPoints: ["January rush, summer slump", "Members cancel after 3 months", "Big-box gyms undercut on price"],
    offers: ["Free 7-day pass", "6-week challenge with a money-back guarantee", "First month for a small flat fee"],
    angles: ["Coaching, not just equipment", "Real member transformations", "Community that keeps you coming"],
    channels: ["Meta (Facebook/Instagram)", "TikTok/Reels"],
    keywords: ["gym near me", "personal trainer", "crossfit", "weight loss program"],
  },
  {
    id: "restaurant",
    label: "Restaurant",
    plural: "restaurants",
    icon: "UtensilsCrossed",
    query: "restaurant",
    osmTags: ["amenity=restaurant"],
    booking: true,
    customerValue: "$25–$80 per visit; regulars worth far more",
    retainer: "$800–$2,500/mo",
    retainerMid: 1500,
    painPoints: ["Slow weeknights", "Delivery apps take a big cut", "Regulars don't hear about new menus or events"],
    offers: ["Free appetizer with first online order", "Weeknight special or happy hour", "Birthday club perk"],
    angles: ["Food shot that stops the scroll", "Order direct, skip the app fees", "Private events and catering"],
    channels: ["Meta (Facebook/Instagram)", "TikTok/Reels", "Google Maps"],
    keywords: ["restaurants near me", "best brunch", "catering", "takeout near me"],
  },
  {
    id: "salon",
    label: "Hair salon / barber",
    plural: "salons and barbershops",
    icon: "Scissors",
    query: "hair salon",
    osmTags: ["shop=hairdresser"],
    osmName: "salon|barber|hair",
    booking: true,
    customerValue: "$500–$1,500 per client per year",
    retainer: "$600–$2,000/mo",
    retainerMid: 1200,
    painPoints: ["Empty chairs mid-week", "No-shows", "Stylists leave and take clients with them"],
    offers: ["First cut at a new-client price", "Free blowout with color", "Refer a friend, both get a discount"],
    angles: ["Book in 30 seconds online", "Stylist spotlight", "Transformation reels"],
    channels: ["Meta (Facebook/Instagram)", "TikTok/Reels", "Google Maps"],
    keywords: ["hair salon near me", "balayage", "barber near me", "haircut"],
  },
  {
    id: "auto_repair",
    label: "Auto repair",
    plural: "auto repair shops",
    icon: "Car",
    query: "auto repair shop",
    osmTags: ["shop=car_repair", "shop=tyres"],
    osmName: "auto|automotive|mechanic|tire|brake|transmission",
    booking: true,
    customerValue: "$400–$1,200 per customer per year",
    retainer: "$800–$2,500/mo",
    retainerMid: 1500,
    painPoints: ["Dealers advertise heavily", "Customers fear being upsold", "Bays sit empty on slow days"],
    offers: ["Oil change special with free inspection", "Free check-engine light scan", "Brake inspection at no charge"],
    angles: ["Honest mechanics, photos of every repair", "Warranty on parts and labor", "Shuttle or loaner while you wait"],
    channels: ["Google Search", "Google Maps", "Meta (Facebook/Instagram)"],
    keywords: ["auto repair near me", "mechanic near me", "brake repair", "check engine light"],
  },
  {
    id: "cleaning",
    label: "Home cleaning",
    plural: "cleaning companies",
    icon: "SprayCan",
    query: "house cleaning service",
    osmTags: ["craft=cleaning", "shop=dry_cleaning"],
    osmName: "clean|maid|janitorial",
    booking: true,
    customerValue: "$1,500–$4,000 per recurring customer per year",
    retainer: "$800–$2,000/mo",
    retainerMid: 1400,
    painPoints: ["One-time cleans that never recur", "Trust with strangers in the home", "Booking by phone tag"],
    offers: ["First deep clean at a set price", "Recurring plan with the 4th clean free", "Move-out cleaning, deposit-back guarantee"],
    angles: ["Background-checked, insured cleaners", "Come home to a clean house", "Book online in 60 seconds"],
    channels: ["Meta (Facebook/Instagram)", "Google Search", "Nextdoor"],
    keywords: ["house cleaning near me", "maid service", "deep cleaning", "move out cleaning"],
  },
  {
    id: "landscaping",
    label: "Landscaping",
    plural: "landscaping companies",
    icon: "Trees",
    query: "landscaping company",
    osmTags: ["craft=gardener"],
    osmName: "landscap|lawn|garden|tree service",
    booking: false,
    customerValue: "$1,000–$10,000+ per project; recurring lawn care",
    retainer: "$800–$2,500/mo",
    retainerMid: 1500,
    painPoints: ["Seasonal cash flow", "Low-ball competitors", "Quotes that never close"],
    offers: ["Free landscape design consult", "First mow free with a seasonal plan", "Spring cleanup package"],
    angles: ["Curb appeal before and after", "Reliable crew that shows up", "Outdoor living spaces"],
    channels: ["Meta (Facebook/Instagram)", "Google Search", "Nextdoor"],
    keywords: ["landscaping near me", "lawn care service", "landscape design", "yard cleanup"],
  },
  {
    id: "pest_control",
    label: "Pest control",
    plural: "pest control companies",
    icon: "Bug",
    query: "pest control",
    osmTags: ["craft=pest_control"],
    osmName: "pest|termite|extermin",
    booking: true,
    customerValue: "$300–$1,000 per year per recurring plan",
    retainer: "$1,000–$3,000/mo",
    retainerMid: 2000,
    painPoints: ["National brands dominate search", "One-off treatments instead of plans", "Seasonal demand"],
    offers: ["First treatment at a reduced price", "Free termite inspection", "Pest-free guarantee or we come back free"],
    angles: ["Safe for kids and pets", "Same-day service", "Local, family-owned"],
    channels: ["Google Search", "Google Local Services"],
    keywords: ["pest control near me", "exterminator", "termite inspection", "rodent removal"],
  },
  {
    id: "veterinarian",
    label: "Veterinarian",
    plural: "veterinary clinics",
    icon: "PawPrint",
    query: "veterinarian",
    osmTags: ["amenity=veterinary"],
    booking: true,
    customerValue: "$500–$1,500 per pet per year",
    retainer: "$1,000–$3,000/mo",
    retainerMid: 2000,
    painPoints: ["Corporate clinics buying up the market", "Phones overloaded", "Preventive visits slipping"],
    offers: ["New-client wellness exam special", "Puppy and kitten package", "Dental month discount"],
    angles: ["Fear-free visits", "Same-day sick visits", "Your pet's family doctor"],
    channels: ["Meta (Facebook/Instagram)", "Google Search", "Google Maps"],
    keywords: ["vet near me", "emergency vet", "pet vaccinations", "dog dental cleaning"],
  },
  {
    id: "physical_therapy",
    label: "Physical therapy",
    plural: "physical therapy clinics",
    icon: "HeartPulse",
    query: "physical therapy clinic",
    osmTags: ["healthcare=physiotherapist"],
    osmName: "physical therapy|physio|rehab|sports medicine",
    booking: true,
    customerValue: "$1,000–$3,000 per plan of care",
    retainer: "$1,000–$3,000/mo",
    retainerMid: 2000,
    painPoints: ["Dependent on doctor referrals", "Patients drop off mid-plan", "Hard to reach cash-pay patients"],
    offers: ["Free injury screen", "Direct access: no referral needed", "Back-to-running program"],
    angles: ["Avoid surgery and pills", "Get back to the sport you love", "Seen this week"],
    channels: ["Meta (Facebook/Instagram)", "Google Search"],
    keywords: ["physical therapy near me", "sports injury clinic", "knee pain treatment", "back pain physical therapy"],
  },
  {
    id: "accountant",
    label: "Accountant / tax",
    plural: "accounting and tax firms",
    icon: "Calculator",
    query: "accountant",
    osmTags: ["office=accountant", "office=tax_advisor"],
    osmName: "cpa|tax|accounting|bookkeep",
    booking: true,
    customerValue: "$1,000–$5,000 per client per year",
    retainer: "$1,000–$3,000/mo",
    retainerMid: 2000,
    painPoints: ["All the work lands in tax season", "Clients shop on price", "Hard to win business clients"],
    offers: ["Free tax-savings review", "Flat monthly bookkeeping", "First-year business filing package"],
    angles: ["Keep more of what you earn", "A CPA who answers emails", "Done before the deadline"],
    channels: ["Google Search", "LinkedIn", "Meta (Facebook/Instagram)"],
    keywords: ["cpa near me", "tax preparation", "small business accountant", "bookkeeping services"],
  },
];

// Research notes per niche (see docs/research.md). Figures come from search
// excerpts of the linked pages and are directional, not benchmarks.
const RESEARCH: Record<string, { customerValue?: string; tip?: string; offers?: string[]; evidence: { text: string; url: string }[] }> = {
  dentist: {
    customerValue: "About $4,000 in production per new patient (older industry data)",
    tip: "A low flat-price new-patient exam shown only within about 8 miles is a classic Meta offer.",
    offers: ["$99 new-patient exam with X-rays", "Free Invisalign consultation with 3D scan", "Same-day emergency appointments"],
    evidence: [
      { text: "New patient worth ~$4,000–4,200 in gross production (2010–16 data)", url: "https://www.dentistryiq.com/practice-management/industry/article/16366795/how-much-is-a-new-patient-worth-to-a-dental-practice-heres-what-the-data-say" },
      { text: "$99 new-patient exam shown within 8 miles", url: "https://redefineweb.com/blog/dental-facebook-ads-examples-book-real-new-patients/" },
      { text: "~$58 median cost per qualified lead on Meta", url: "https://delmain.co/?p=259883" },
    ],
  },
  med_spa: {
    customerValue: "About $530 per visit; most patients come back",
    tip: "New creative built around a clear per-unit Botox deal more than doubled leads in one published case.",
    evidence: [
      { text: "~$527–536 spent per visit", url: "https://www.americanmedspa.org/med-spa-statistics" },
      { text: "73% of patients are repeat patients", url: "https://www.americanmedspa.org/blog/2024-medical-spa-state-of-the-industry-executive-report" },
      { text: "Botox deal creative: +117% leads, −56% cost per lead", url: "https://hawksem.com/results/kalologie/" },
    ],
  },
  roofer: {
    customerValue: "About $9,500 per average roof replacement",
    tip: "Facebook fails with broad targeting; it works with education content plus retargeting. Search and Local Services Ads catch urgent demand.",
    evidence: [
      { text: "$9,528 average roof replacement", url: "https://www.homeadvisor.com/article.show.Where-does-Your-Money-Go-for-a-Roof-Installation.16862.html" },
      { text: "Why Facebook ads fail roofers, and when they work", url: "https://jobnimbus.com/blog/why-facebook-ads-fail-roofers-and-when-they-actually-work" },
      { text: "~$162 per Local Services Ads lead", url: "https://themediacaptain.com/google-local-service-ad-statistics/" },
    ],
  },
  hvac: {
    customerValue: "About $7,500 per replacement; installs averaged ~$17,000 invoiced in 2025",
    tip: "\u201cFree estimate\u201d is too generic. Lead with a specific, valuable offer.",
    evidence: [
      { text: "$17,040 average invoiced install (2025)", url: "https://www.servicetitan.com/toolbox/state-of-the-trades/trends/hvac-replacement-cost-by-state" },
      { text: "Generic \u201cfree estimate\u201d offers underperform", url: "https://hookagency.com/blog/hvac-facebook-ads/" },
      { text: "Local Services Ads: ~$51/lead, ~$116 per booked job", url: "https://elevarus.com/hvac-lead-generation-cost-per-lead-2026-benchmarks/" },
    ],
  },
  plumber: {
    customerValue: "About $1,700 average ticket from Local Services Ads",
    tip: "Plumbing is urgent-intent: Local Services Ads and search beat social.",
    evidence: [{ text: "LSA: $57 per lead, 44.5% booking rate, $1,714 avg ticket (Feb 2026)", url: "https://www.enrichlabs.ai/blog/plumbing-marketing-complete-guide-2026" }],
  },
  chiropractor: {
    tip: "Low-priced first-visit packages (exam, adjustment, X-rays) are the common entry offer.",
    offers: ["New-patient exam, X-rays and adjustment at one low price", "Free back-pain screening", "Sciatica relief program"],
    evidence: [
      { text: "$29 exam + adjustment + X-rays listed as a $150 value", url: "https://www.groupon.com/deals/brodwyn-and-associates" },
      { text: "Google for active searchers, Meta for awareness", url: "https://www.perfectpatients.com/adwords-vs-facebook-ads-for-chiropractors/" },
    ],
  },
  law_pi: {
    customerValue: "33–40% contingency on recoveries that can reach tens of thousands",
    tip: "Legal has the most expensive clicks. Local Services Ads signed cases for less than Google Ads in one large 2025 dataset.",
    evidence: [
      { text: "33–40% standard contingency fee", url: "https://www.nolo.com/legal-encyclopedia/what-is-the-standard-contingency-fee-for-a-car-accident-lawyer.html" },
      { text: "Cost per signed case: LSA $2,485 vs Google Ads $2,971", url: "https://www.attorneyatwork.com/building-law-firm-ppc-strategy/" },
      { text: "Legal: highest Google Ads cost per lead ($131.63)", url: "https://www.wordstream.com/blog/2025-google-ads-benchmarks" },
    ],
  },
  real_estate: {
    customerValue: "About 2.4% commission per side on each deal",
    tip: "Seller \u201chome value\u201d lead ads are the workhorse; real estate runs under Meta's housing Special Ad Category.",
    evidence: [
      { text: "2.42% average buyer-agent commission (Q3 2025)", url: "https://www.redfin.com/news/commissions-q3-2025/" },
      { text: "Seller leads at $24.50 each → 2 listings", url: "https://www.luxurypresence.com/case-studies/seller-leads-at-24-50-cpl-in-san-francisco" },
    ],
  },
  gym: {
    customerValue: "Example: $250/month × 24 months ≈ $6,000 per member",
    tip: "Six-week challenges with a refundable deposit; keep cost per sale under about $250.",
    evidence: [
      { text: "6-week challenge playbook", url: "https://www.pushpress.com/blog/use-6-week-challenges-to-increase-your-bottom-line" },
      { text: "$15–25 is a typical cost per lead", url: "https://twobrainbusiness.com/paid-ads-guide/" },
    ],
  },
  restaurant: {
    tip: "Fix the Google Business Profile before buying any ads.",
    evidence: [
      { text: "Local SEO for restaurants", url: "https://www.owner.com/blog/local-seo-for-restaurants" },
      { text: "~$30 Google Ads cost per lead for restaurants", url: "https://www.wordstream.com/blog/2025-google-ads-benchmarks" },
    ],
  },
  salon: {
    customerValue: "Median ticket ~$114 at full-service salons",
    tip: "A first-visit discount plus a referral credit for the client who sent them.",
    offers: ["25% off the first visit", "Refer a friend: they save 25%, you get a credit", "Free blowout with color"],
    evidence: [
      { text: "25% off for new clients + $10 referral credit", url: "https://biz.booksy.com/en-us/blog/special-offers-more-customers" },
      { text: "Median ticket $114 (full-service), $77 (specialty)", url: "https://www.zenoti.com/thecheckin/the-2026-beauty-and-wellness-benchmark-report-salon-edition" },
    ],
  },
  auto_repair: {
    customerValue: "Typical repair order $500–$750",
    tip: "Coupon oil-change buyers rarely return. Promote brakes and diagnostics, and start with Local Services Ads.",
    offers: ["Free check-engine light scan", "Brake inspection at no charge", "Oil change special with free inspection"],
    evidence: [
      { text: "Most common average repair order: $500–749", url: "https://get.partstech.com/report2025" },
      { text: "Promote brakes/diagnostics over oil-change coupons", url: "https://thinkprofits.com/ppc-advertising/ppc-for-auto-repair/" },
      { text: "Auto repair: lowest Google Ads cost per lead ($28.50)", url: "https://www.wordstream.com/blog/2025-google-ads-benchmarks" },
    ],
  },
  cleaning: {
    customerValue: "About $175 per visit; recurring plans multiply it",
    tip: "Discount the first or deep clean, then convert to a recurring plan.",
    evidence: [
      { text: "~$175 average per visit", url: "https://www.homeadvisor.com/cost/cleaning-services/hire-a-maid-service" },
      { text: "Facebook ads for cleaning businesses", url: "https://www.zenmaid.com/magazine/facebook-advertising/" },
    ],
  },
};

for (const n of NICHES) {
  const r = RESEARCH[n.id];
  if (!r) continue;
  if (r.customerValue) n.customerValue = r.customerValue;
  if (r.offers) n.offers = r.offers;
  n.tip = r.tip;
  n.evidence = r.evidence;
}

export function getNiche(id: string | undefined): Niche | undefined {
  if (!id) return undefined;
  return NICHES.find((n) => n.id === id);
}

/** Best-effort match of free text ("dental office", "roofers") to a niche. */
export function matchNiche(text: string | undefined): Niche | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().trim();
  const direct = NICHES.find((n) => n.id === t || n.label.toLowerCase() === t || n.plural === t);
  if (direct) return direct;
  const words: Record<string, string> = {
    dent: "dentist", ortho: "dentist", "med spa": "med_spa", medspa: "med_spa", botox: "med_spa", aesthetic: "med_spa",
    roof: "roofer", hvac: "hvac", "air cond": "hvac", heating: "hvac", plumb: "plumber", chiro: "chiropractor",
    injury: "law_pi", lawyer: "law_pi", attorney: "law_pi", "law firm": "law_pi", realt: "real_estate",
    "real estate": "real_estate", gym: "gym", fitness: "gym", crossfit: "gym", yoga: "gym", pilates: "gym",
    restaurant: "restaurant", cafe: "restaurant", pizza: "restaurant", salon: "salon", barber: "salon", hair: "salon",
    auto: "auto_repair", mechanic: "auto_repair", tire: "auto_repair", clean: "cleaning", maid: "cleaning",
    landscap: "landscaping", lawn: "landscaping", pest: "pest_control", termite: "pest_control", vet: "veterinarian",
    "physical ther": "physical_therapy", physio: "physical_therapy", account: "accountant", cpa: "accountant", tax: "accountant",
  };
  // Match at the start of a word only, so "accident" doesn't match "dent".
  for (const [needle, id] of Object.entries(words)) {
    const re = new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    if (re.test(t)) return getNiche(id);
  }
  return undefined;
}
