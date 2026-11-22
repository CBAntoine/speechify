# Pricing: what the store sells and why it costs what it does

Rainmaker's store (`/store`) sells every ElevenLabs capability as a **done-for-you service from your agency**: an AI receptionist you set up and run, voiceovers you produce, videos you dub, ads you write and design. The client pays your agency every month. They never get an ElevenLabs account or ElevenLabs credits from you.

Every price below is a default. Change any of them, hide products, or pick another currency in **Store & pricing**. The margin column there updates as you type.

Prices and costs were checked on 21–22 November 2026. ElevenLabs changes its prices; re-check the sources before you rely on the margins.

## Why services, not resold credits

ElevenLabs' [Terms of Service](https://elevenlabs.io/terms-of-use) shape how this can be sold:

- **No reselling credits.** §6(b)(iv): "Prepaid Credits may not be transferred, sold, gifted, traded, sublicensed, or assigned, whether for value or otherwise." So the store never sells "ElevenLabs minutes" or "characters". It sells outcomes (calls answered, voiceovers delivered, videos dubbed) that your agency produces with your own ElevenLabs plan.
- **Commercial use needs a paid plan.** §1(c): paid users "may use the Services for commercial purposes", within the Prohibited Use Policy. Run client work on a paid ElevenLabs plan (Starter or above on ElevenAgents includes the commercial license).
- **You're responsible for how it's used.** §1(b): an entity is responsible for its people's use of the Services. The store's terms page and the sales assistant's rules (consent for follow-up calls and voice clones, AI disclosure) exist for this.
- **Their name isn't your brand.** §5(c): the ElevenLabs name and logos "may not be copied, imitated or used, in whole or in part, without our prior written permission", and mentioning a product doesn't imply endorsement. The store brands everything as your agency. With **Say products are built on ElevenLabs** on (Store & pricing), the store mentions ElevenLabs in plain text and the footer adds a notice that ElevenLabs is a trademark of ElevenLabs Inc. and that you're independent and not endorsed. Turn it off to leave ElevenLabs out of the store. This isn't legal advice: if you want to feature ElevenLabs prominently, ask them for permission or check their partner program.

## The price structure

- **Monthly recurring price** for every product and plan, with a usage allowance each month (call minutes, messages, voiceovers, video minutes…).
- **One-time setup fee** where there's real build work (receptionists, agents, brand voices, campaigns). Products with no setup work have none.
- **Yearly billing = 10 months' price for 12** ("2 months free"). The setup fee is waived on yearly plans by default (Store & pricing → "Waive setup fees on yearly"). Yearly money up front pays for your ElevenLabs plan and cuts churn.
- **Overage**: $0.25 per call minute beyond a plan's allowance (changeable). The FAQ and the assistant both say so; you warn the client before it happens.
- **Three plans** anchor the store. Growth is highlighted as "most popular": it's the one most local businesses need (answer calls + follow up + advertise), and it sits between a cheap entry and a premium tier.
- **Payment**: card through Stripe Checkout or PayPal subscriptions. Both bill the setup fee once and the recurring price automatically, and cancellations and failed payments flow back into Rainmaker through webhooks.

### Plans

| Plan | Monthly | Setup | Yearly | What's in it | Est. cost to you* | Gross margin |
|---|---|---|---|---|---|---|
| **Launch** | $297 | $497 | $2,970 | AI phone receptionist (400 call minutes), website voice & chat agent (2,000 messages), English + Spanish, call summaries, monthly report | $49.65 | 83% |
| **Growth** ★ | $597 | $997 | $5,970 | Everything in Launch with 1,200 call minutes shared with follow-up and reminder calls, a custom brand voice, 90+ languages, a new ad campaign each month, 8 AI images, 2 audio ads, on-hold music and a sonic logo | $143.05 | 76% |
| **Scale** | $1,297 | $1,997 | $12,970 | Everything in Growth with 3,000 call minutes across up to 3 agents, WhatsApp agent, 20 images and 4 video ads a month, 30 minutes of dubbing, 4 podcast episodes, website audio, every call transcribed, quarterly strategy call | $404.75 | 69% |

A plan costs less than buying its parts separately (Launch's two products are $394/mo on their own), which the plan cards show.

### Products (à la carte)

| Product | Monthly | Setup | Main allowance | Built on | Est. cost* | Margin |
|---|---|---|---|---|---|---|
| AI Phone Receptionist | $247 | $497 | 300 call minutes | ElevenAgents, Eleven v4 Turbo, Scribe v3 Live | $31.15 | 87% |
| Website Voice & Chat Agent | $147 | $297 | 2,000 messages | ElevenAgents widget, knowledge base | $23.00 | 84% |
| AI Follow-Up & Reminder Calls | $297 | $497 | 750 outbound minutes | ElevenAgents batch calling | $82.50 | 72% |
| WhatsApp AI Agent | $197 | $297 | 3,000 messages | ElevenAgents WhatsApp channel | $12.00 | 94% |
| Multilingual Add-On | $97 | – | 90+ languages on all agents | Language detection, v4 Turbo | $0.50 | 99% |
| Live AI Interpreter | $197 | $297 | 200 minutes | Realtime translation | $40.00 | 80% |
| Studio Voiceovers & Audio Ads | $147 | – | 8 voiceovers (60 s) | Eleven v4, Text to Dialogue | $2.50 | 98% |
| Custom Brand Voice | $97 | $497 | 1 designed or cloned voice | Voice Design, Voice Cloning | $1.00 | 99% |
| AI Video Dubbing | $297 | – | 30 video minutes | Dubbing v1/v2 | $15.00 | 95% |
| Podcast & Audiobook Studio | $297 | $297 | 4 episodes (15 min) | Studio, Eleven v4, Eleven Music | $8.30 | 97% |
| "Listen to This Page" Website Audio | $49 | $99 | 20 pages | Audio Native | $8.00 | 84% |
| Custom Music, Jingles & Sonic Logo | $147 | – | 10 tracks (3 min) | Eleven Music, Sound Effects | $5.30 | 96% |
| AI Ad Images & Video | $297 | – | 20 images + 4 short videos | Image & Video API | $27.00 | 91% |
| AI Spokesperson Videos | $397 | $297 | 6 videos (60 s) | Image & Video (talking presenter), Eleven v4 | $31.50 | 92% |
| Call & Meeting Transcription + Insights | $97 | – | 100 hours of audio | Scribe v3 | $26.00 | 73% |
| Captions & Subtitles | $79 | – | 20 hours of video | Scribe v3, Forced Alignment | $5.00 | 94% |
| Audio Cleanup & Voice Changer | $79 | – | 120 minutes | Voice Isolator, Voice Changer | $14.40 | 82% |
| Done-For-You Ad Campaigns | $397 | $297 | 1 full campaign | Claude (writing), Image & Video (art) | $7.50 | 98% |

\* **Est. cost** is the variable cost if the client uses their *whole* allowance: ElevenLabs usage, LLM tokens, a phone number and Claude writing. Most clients use less. It leaves out your fixed costs (below), card fees and your time. The low-cost products (voiceovers, music, brand voice) are priced on the **labour and expertise** (scripts, picking voices, revisions, delivery), not on the API bill.

## Unit costs and where they come from

From the code (`UNIT_COSTS` in `src/lib/catalog.ts`):

| Unit | Cost used | Source |
|---|---|---|
| Agent call minute | $0.10 | ElevenAgents: $0.08/min on every plan, plus LLM tokens (billed separately, varies by model) and the carrier's charge. Burst calls over your concurrency limit are $0.16/min. [elevenlabs.io/pricing/agents](https://elevenlabs.io/pricing/agents) |
| Outbound call minute | $0.11 | Same, with a higher carrier rate |
| Chat / WhatsApp message | $0.004 | ElevenAgents text message $0.003 + LLM tokens. [elevenlabs.io/pricing/agents](https://elevenlabs.io/pricing/agents) |
| Phone number | $1.15/mo | A local number from Twilio (your own telephony provider; ElevenLabs adds no telephony fee) |
| Text to speech, about 1 minute | $0.08 | Eleven v4: $0.08 per 1,000 characters (v4 Turbo: $0.04). [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| Finished 60-second voiceover | $0.25 | TTS with retakes |
| Transcription hour | $0.25 | Scribe v3: $0.20/hour (Scribe v3 Live: $0.22/hour). [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| Dubbed minute | $0.50 | Dubbing v1: $0.33/min (Dubbing v2: $2.20/min, priced as a premium option). [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| Music minute | $0.15 | Eleven Music: $0.15/min. [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| Sound effect | $0.04 | Sound Effects: $0.12/min of audio; a typical effect is under 20 s |
| Audio cleanup / voice change minute | $0.12 | Voice Isolator and Voice Changer: $0.12/min. [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| Live translation minute | $0.20 | Estimate; check your workspace's rate |
| Ad image | $0.75 | Estimate: Image & Video is billed in credits and varies by model (GPT Image 2, Gemini image models) |
| Short video clip | $3.00 | Estimate (Veo 3.1 Fast), billed in credits |
| Talking-presenter video | $5.00 | Estimate, billed in credits |
| Full ad campaign (Claude) | $1.50 | Claude Opus 5.5 tokens for one campaign |
| Scripts, summaries, reports (Claude) | $0.50 | Claude tokens |

## Fixed costs to budget for

| Cost | Roughly | Notes |
|---|---|---|
| ElevenLabs plan | $99–$990/mo | ElevenAgents Pro ($99) includes 1,238 call minutes; Scale ($299) 3,738; Business ($990) 12,375. Extra minutes are $0.08. Image & Video needs Pro or above. |
| Claude API | usage | Ads, outreach, Autopilot, agents |
| Twilio | ~$1.15/number + carrier minutes | One number per receptionist client |
| Hosting + database | $0–$20/mo | Vercel + Neon free tiers work to start |
| Card and PayPal fees | ~3% of each payment | Not in the margin figures above |
| Email sending (Resend) | free tier, then usage | For Autopilot outreach |

For scale: five Launch clients bring in $1,485 a month and cost about $250 in usage if they use every included minute; ten Growth clients bring in $5,970 and cost about $1,430 at full usage. Add your ElevenLabs plan on top. One Growth client pays for an ElevenLabs Scale plan ($299) about twice.

## Compared with GoHighLevel

GoHighLevel sells software for the agency to operate: Starter $97/mo, Unlimited $297/mo, Founder $497/mo (SaaS mode), plus AI Employee at $50–$97 per sub-account per month and usage-based phone, SMS, email and AI charges ([gohighlevel.com/pricing](https://www.gohighlevel.com/pricing), checked 21 November 2026).

Rainmaker is the agency's own tool, so there's no per-seat platform fee. The store sells finished services to the client at service prices, which is why a Launch plan costs about what GoHighLevel's Unlimited plan does: the client gets a working receptionist, not a login.

## Rules the store and Autopilot follow

- **AI disclosure.** Receptionists and the sales assistant say they're AI when asked; the demo pages say so up front.
- **Follow-up and reminder calls** only go to people who opted in (TCPA in the US, CASL in Canada). Autopilot never calls or texts prospects. It emails, and every email has your postal address and an opt-out line (CAN-SPAM). Set your mailing address in Settings.
- **Voice cloning** needs the written consent of the person whose voice it is. The Custom Brand Voice product says so, and so does the assistant.
- **No guaranteed results.** The sales assistant is told not to promise numbers of customers or revenue, and the tests on it check this.
- **Taxes.** Prices exclude tax. Set `STRIPE_AUTOMATIC_TAX=1` with Stripe Tax switched on to charge sales tax or VAT automatically on card payments.
- **Refunds and cancellations.** The store's terms page (`/store/terms`) says monthly plans can be cancelled any time and end at the close of the billing period; setup fees cover work already done. Edit the wording to match your own policy.
