// First-run data: a default agency profile and a small, clearly labelled
// sample workspace so every screen has something to show. Sample businesses
// are fictional and use reserved ".example" domains.

import type { AdCampaign, AgencyProfile, AuditResult, Db, Draft, Lead, PaymentsState, Stage, Task, Activity } from "./types.ts";
import { deriveSignals, scoreProspect } from "./prospecting/score.ts";
import { getNiche } from "./niches.ts";
import { DEFAULT_STORE } from "./catalog.ts";
import { defaultAutopilot } from "./autopilot/plan.ts";

export function defaultPayments(): PaymentsState {
  return { stripe: {}, paypal: { products: {}, plans: {} }, seenEvents: [] };
}

export function defaultProfile(): AgencyProfile {
  return {
    agencyName: "Your Agency",
    ownerName: "",
    email: "",
    phone: "",
    website: "",
    city: "",
    services: ["Google & Meta ads", "Websites that book appointments", "Review generation", "Missed-call text-back"],
    coreOffer: "We fill your calendar with booked appointments using ads, a fast website and automatic follow-up. You only keep paying if it works.",
    pricing: "Setup $500, then $1,500/month. Cancel anytime.",
    calendarUrl: "",
    voice: "Friendly, direct and specific. Short sentences. No hype, no jargon.",
    targetNiches: ["dentist", "med_spa", "roofer"],
    proof: "",
    mailingAddress: "",
  };
}

function audit(p: Partial<AuditResult>): AuditResult {
  return {
    url: p.url,
    finalUrl: p.finalUrl ?? p.url,
    fetchedAt: new Date().toISOString(),
    reachable: true,
    https: true,
    status: 200,
    responseMs: 900,
    mobileViewport: true,
    analytics: ["Google Analytics 4"],
    pixels: [],
    booking: [],
    chat: [],
    reviewsWidgets: [],
    hasContactForm: true,
    hasClickToCall: true,
    hasSchema: false,
    hasOgImage: true,
    socials: ["Facebook"],
    emails: [],
    phones: [],
    title: "Home",
    description: "Local business",
    ...p,
  };
}

const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86400_000 - hours * 3600_000).toISOString();

function sampleLead(input: {
  id: string;
  name: string;
  niche: string;
  city: string;
  stage: Stage;
  website?: string;
  phone?: string;
  email?: string;
  contactName?: string;
  rating?: number;
  reviewCount?: number;
  audit?: AuditResult;
  nextStep?: string;
  notes?: string;
  daysAgo: number;
}): Lead {
  const niche = getNiche(input.niche);
  const signals = deriveSignals({
    website: input.website,
    phone: input.phone,
    rating: input.rating,
    reviewCount: input.reviewCount,
    booking: niche?.booking,
    retainerMid: niche?.retainerMid,
    audit: input.audit,
    source: "sample",
  });
  const score = scoreProspect(
    { website: input.website, phone: input.phone, rating: input.rating, reviewCount: input.reviewCount, booking: niche?.booking, retainerMid: niche?.retainerMid, audit: input.audit },
    signals
  );
  return {
    id: input.id,
    name: input.name,
    niche: input.niche,
    category: niche?.label,
    city: input.city,
    address: `${input.city} (sample)`,
    phone: input.phone,
    email: input.email,
    website: input.website,
    rating: input.rating,
    reviewCount: input.reviewCount,
    source: "sample",
    stage: input.stage,
    value: niche?.retainerMid,
    score,
    signals,
    audit: input.audit,
    notes: input.notes,
    contactName: input.contactName,
    nextStep: input.nextStep,
    sample: true,
    createdBy: "sample",
    createdAt: ago(input.daysAgo),
    updatedAt: ago(Math.max(0, input.daysAgo - 1)),
    lastContactAt: input.stage === "new" ? undefined : ago(Math.max(0, input.daysAgo - 2)),
  };
}

function sampleLeads(): Lead[] {
  return [
    sampleLead({
      id: "lead_sample_dental",
      name: "Brightside Family Dental",
      niche: "dentist",
      city: "Austin, TX",
      stage: "new",
      website: "https://brightside-dental.example",
      phone: "(512) 555-0142",
      rating: 4.6,
      reviewCount: 41,
      audit: audit({ url: "https://brightside-dental.example", booking: [], chat: [], pixels: [], copyrightYear: 2021, responseMs: 3400 }),
      nextStep: "Send first email about online booking",
      daysAgo: 1,
    }),
    sampleLead({
      id: "lead_sample_roof",
      name: "Summit Peak Roofing",
      niche: "roofer",
      city: "Denver, CO",
      stage: "contacted",
      website: "http://summitpeakroofing.example",
      phone: "(720) 555-0188",
      contactName: "Dana",
      rating: 4.1,
      reviewCount: 17,
      audit: audit({ url: "http://summitpeakroofing.example", https: false, mobileViewport: false, analytics: [], hasContactForm: false, socials: [] }),
      nextStep: "Follow up Thursday with storm-season ad mockup",
      daysAgo: 4,
    }),
    sampleLead({
      id: "lead_sample_medspa",
      name: "Glow Aesthetics Med Spa",
      niche: "med_spa",
      city: "Scottsdale, AZ",
      stage: "replied",
      website: "https://glowaesthetics.example",
      phone: "(480) 555-0110",
      email: "hello@glowaesthetics.example",
      contactName: "Priya",
      rating: 4.8,
      reviewCount: 212,
      audit: audit({ url: "https://glowaesthetics.example", pixels: ["Meta Pixel"], booking: ["Vagaro"], chat: [], socials: ["Instagram", "Facebook", "TikTok"] }),
      nextStep: "Book a 20-min call: she asked about pricing",
      notes: "Runs Meta ads already. Unhappy with lead quality from current agency.",
      daysAgo: 6,
    }),
    sampleLead({
      id: "lead_sample_chiro",
      name: "Northgate Chiropractic",
      niche: "chiropractor",
      city: "Columbus, OH",
      stage: "meeting",
      website: "https://northgatechiro.example",
      phone: "(614) 555-0175",
      contactName: "Dr. Ellis",
      rating: 4.9,
      reviewCount: 96,
      audit: audit({ url: "https://northgatechiro.example", booking: [], pixels: [], chat: [] }),
      nextStep: "Demo call Tuesday 2pm",
      daysAgo: 9,
    }),
    sampleLead({
      id: "lead_sample_hvac",
      name: "Copperline Heating & Air",
      niche: "hvac",
      city: "Raleigh, NC",
      stage: "proposal",
      website: "https://copperlinehvac.example",
      phone: "(919) 555-0133",
      contactName: "Marcus",
      rating: 4.4,
      reviewCount: 58,
      audit: audit({ url: "https://copperlinehvac.example", pixels: ["Google Ads tag"], chat: [], booking: [] }),
      nextStep: "Proposal sent: $2,500/mo. Check in Friday.",
      daysAgo: 13,
    }),
    sampleLead({
      id: "lead_sample_gym",
      name: "Ironclad Fitness",
      niche: "gym",
      city: "Tampa, FL",
      stage: "won",
      website: "https://ironcladfit.example",
      phone: "(813) 555-0160",
      contactName: "Jordan",
      rating: 4.7,
      reviewCount: 133,
      audit: audit({ url: "https://ironcladfit.example", pixels: ["Meta Pixel"], booking: ["Mindbody"], chat: ["tawk.to"] }),
      nextStep: "Launch 6-week challenge campaign",
      daysAgo: 21,
    }),
    sampleLead({
      id: "lead_sample_clean",
      name: "Fresh Start Cleaning Co.",
      niche: "cleaning",
      city: "Nashville, TN",
      stage: "new",
      phone: "(615) 555-0121",
      rating: 4.3,
      reviewCount: 9,
      nextStep: "Pitch a simple booking site",
      daysAgo: 0,
    }),
  ];
}

function sampleDrafts(): Draft[] {
  return [
    {
      id: "draft_sample_1",
      leadId: "lead_sample_dental",
      leadName: "Brightside Family Dental",
      channel: "email",
      to: "",
      subject: "Booking a cleaning at Brightside takes a phone call",
      body:
        "Hi there,\n\nI tried to book a cleaning on brightside-dental.example tonight and there's no way to do it online. The page also took about 3 seconds to load on my phone.\n\nMost practices near you now let new patients book in under a minute, and those bookings come in at night and on weekends when the front desk is closed.\n\nWe set up online booking plus automatic reminders for dental offices. I can show you a 2-minute walkthrough of what it would look like on your site. Worth a look?\n\n— Your Agency",
      rationale: "Leads with the clearest gap (no online booking), keeps it short and asks for a small yes.",
      status: "pending",
      createdBy: "agent:outreach",
      createdAt: ago(0, 3),
      sample: true,
    },
    {
      id: "draft_sample_2",
      leadId: "lead_sample_roof",
      leadName: "Summit Peak Roofing",
      channel: "sms",
      to: "(720) 555-0188",
      body: "Hi Dana, following up on my note last week. I mocked up two storm-season ads for Summit Peak. Want me to text them over?",
      rationale: "Second touch, offers a free asset instead of asking for a meeting.",
      status: "pending",
      createdBy: "agent:outreach",
      createdAt: ago(0, 5),
      sample: true,
    },
  ];
}

function sampleCampaign(): AdCampaign {
  return {
    id: "camp_sample_medspa",
    leadId: "lead_sample_medspa",
    businessName: "Glow Aesthetics Med Spa",
    niche: "med_spa",
    location: "Scottsdale, AZ",
    goal: "Book first-time Botox appointments",
    offer: "First Botox visit at a set price per unit",
    website: "https://glowaesthetics.example",
    createdAt: ago(2),
    createdBy: "agent:ads",
    sample: true,
    strategy: {
      summary:
        "Lead with a clear first-visit price and real results. Most local med spas show generic stock photos; Glow has 212 reviews at 4.8 stars, so put that proof up front and send clicks straight to Vagaro booking.",
      audience: "Women 28–55 within 15 miles of Scottsdale, interested in skincare, beauty and wellness. Exclude current clients.",
      angles: [
        { name: "Clear price", hook: "Botox at $11/unit for your first visit", why: "Price uncertainty is the top reason people don't book." },
        { name: "Natural results", hook: "Look like you, just rested", why: "Fear of looking 'done' is the main objection." },
        { name: "Social proof", hook: "212 Scottsdale reviews. 4.8 stars.", why: "Trust beats discounts in aesthetics." },
      ],
      budget: "$40/day on Meta for 14 days, then shift to the best two ads. Add $15/day Google Search on 'botox scottsdale'.",
      kpis: ["Cost per booked consult under $45", "Booking rate from click above 8%", "Show rate above 80% with SMS reminders"],
    },
    meta: [
      {
        angle: "Clear price",
        primaryText:
          "Thinking about Botox but not sure what it costs? First visit at Glow is $11/unit, with a licensed injector who'll tell you honestly how much you need. Book in 60 seconds.",
        headline: "First Botox visit: $11/unit",
        description: "Licensed injectors in Scottsdale",
        cta: "Book Now",
        creativeIdea: "Clean card with the price large, injector portrait on the right, 4.8★ badge.",
      },
      {
        angle: "Natural results",
        primaryText: "The goal isn't to look different. It's to look rested. Our injectors are known for natural results, and 212 Scottsdale clients agree.",
        headline: "Look like you, just rested",
        description: "Free consultation included",
        cta: "Book Now",
        creativeIdea: "Soft before/after split, no heavy filters.",
      },
    ],
    google: {
      headlines: [
        "Botox in Scottsdale",
        "First Visit $11/Unit",
        "Licensed Injectors",
        "212 Five-Star Reviews",
        "Book Online in 60 Sec",
        "Natural-Looking Results",
        "Same-Week Appointments",
        "Free Consultation",
      ],
      descriptions: [
        "Natural results from licensed injectors. First visit at $11/unit. Book online today.",
        "Rated 4.8 stars by 212 Scottsdale clients. Free consult with every first appointment.",
      ],
      keywords: ["botox scottsdale", "botox near me", "med spa scottsdale", "lip filler scottsdale"],
      negativeKeywords: ["jobs", "training", "certification", "diy"],
    },
    video: [
      {
        title: "What $11/unit actually gets you",
        hook: "Here's exactly what your first Botox visit at Glow looks like.",
        script:
          "Hook on camera at the front desk. Walk through: consult, mapping, treatment (10 minutes), aftercare. End with the price on screen and 'book in 60 seconds'.",
        shots: ["Injector greeting at desk", "Face mapping close-up", "Timer showing 10 minutes", "Price card + booking screen"],
      },
    ],
    landing: {
      headline: "Natural-looking Botox in Scottsdale",
      subheadline: "First visit $11/unit with a licensed injector. Book online in 60 seconds.",
      bullets: ["Licensed injectors, not sales reps", "212 reviews, 4.8 stars", "Same-week appointments"],
      cta: "Book your first visit",
    },
    creative: {
      headline: "Botox, first visit $11/unit",
      subline: "Licensed injectors · Natural results",
      badge: "4.8★ · 212 reviews",
      cta: "Book in 60 seconds",
      palette: { bg: "#1f1530", fg: "#fff7f2", accent: "#f2b8a2" },
    },
  };
}

function sampleTasks(): Task[] {
  return [
    { id: "task_sample_1", title: "Prep demo for Northgate Chiropractic", leadId: "lead_sample_chiro", due: ago(-2), done: false, createdBy: "agent:ops", createdAt: ago(1) },
    { id: "task_sample_2", title: "Follow up on Copperline proposal", leadId: "lead_sample_hvac", due: ago(-1), done: false, createdBy: "agent:ops", createdAt: ago(1) },
    { id: "task_sample_3", title: "Send Glow Aesthetics pricing + case study", leadId: "lead_sample_medspa", due: ago(0), done: false, createdBy: "user", createdAt: ago(2) },
  ];
}

function sampleActivity(): Activity[] {
  return [
    { id: "act_s1", at: ago(0, 3), kind: "draft", text: "Outreach Writer drafted an email to Brightside Family Dental", leadId: "lead_sample_dental", agentId: "outreach" },
    { id: "act_s2", at: ago(0, 6), kind: "lead", text: "Prospector found 7 cleaning companies in Nashville, saved the top 1", agentId: "prospector" },
    { id: "act_s3", at: ago(1), kind: "stage", text: "Glow Aesthetics Med Spa moved to Replied", leadId: "lead_sample_medspa" },
    { id: "act_s4", at: ago(2), kind: "ad", text: "Ad Strategist built a Botox campaign for Glow Aesthetics", leadId: "lead_sample_medspa", agentId: "ads" },
    { id: "act_s5", at: ago(3), kind: "stage", text: "Ironclad Fitness signed: $1,800/mo", leadId: "lead_sample_gym" },
  ];
}

export function seedDb(opts: { withSamples: boolean }): Db {
  const samples = opts.withSamples;
  return {
    version: 1,
    profile: defaultProfile(),
    leads: samples ? sampleLeads() : [],
    drafts: samples ? sampleDrafts() : [],
    campaigns: samples ? [sampleCampaign()] : [],
    tasks: samples ? sampleTasks() : [],
    runs: [],
    activity: samples ? sampleActivity() : [],
    managed: { agents: {} },
    orders: [],
    store: structuredClone(DEFAULT_STORE),
    payments: defaultPayments(),
    autopilot: defaultAutopilot(),
    clients: [],
    seeded: true,
  };
}
