# Messaging rules: texts, email, calls and reviews, by country

> **This is product guidance, not legal advice.** It summarizes public laws, regulators' guidance and platform policies as they stood on **22 November 2026**. Laws change, courts read them differently, and your client's industry may have extra rules (health, finance, debt collection, real estate). Before a campaign that matters, check with a lawyer in the country you're messaging. Where we couldn't confirm something, we say so.

Rainmaker texts and emails past customers to win them back, replies to new website leads within seconds, texts people back after a missed call, asks customers for reviews and referrals, and answers calls with an AI voice agent. This page explains the rules behind the defaults it uses, country by country. The defaults themselves live in [`src/lib/compliance-data.ts`](../src/lib/compliance-data.ts), which covers every country and territory in North America. Puerto Rico and the US Virgin Islands follow the US rules.

**Contents:** [What the software does by default](#what-the-software-does-by-default-and-why) · [Key dates](#key-dates) · [United States](#united-states) · [Canada](#canada) · [Mexico](#mexico) · [WhatsApp](#whatsapp-business-platform-everywhere) · [Google reviews](#google-reviews-everywhere) · [Other countries](#other-countries-and-territories) · [What we couldn't confirm](#what-we-couldnt-confirm)

---

## What the software does by default, and why

### 1. It gets consent before marketing

Each country has a consent level for marketing texts (`smsConsent`) and one for marketing email (`emailConsent`). The software won't send a marketing text or email to a contact who doesn't meet it.

| Level | What it means | Used in |
|---|---|---|
| **Written consent** (`express_written`) | A signed agreement (a checkbox or e-signature counts) that names the business, covers marketing texts, and says consent isn't a condition of purchase. | Texts in the US ([47 CFR 64.1200](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)) |
| **Opt-in** (`express`) | The person clearly said yes to marketing from this business, and you have a record of it. | Texts almost everywhere outside the US, Canada and Mexico. Email in the French territories, Greenland, Costa Rica, the Dominican Republic, Panama, Nicaragua, El Salvador, Cuba, and Antigua and Barbuda |
| **Existing relationship** (`implied_ok`) | A recent customer, or someone who recently asked about the business, who hasn't opted out. In Canada this means a purchase in the last 2 years or an inquiry in the last 6 months ([CRTC](https://crtc.gc.ca/eng/com500/guide.htm)). | Texts and email in Canada and Mexico, and in places whose law gives people a right to stop direct marketing (Jamaica, the Bahamas, Barbados, Cayman, Bermuda, BVI). Email in most other places |
| **Opt-out** (`opt_out_ok`) | Anyone may be emailed until they unsubscribe. | Email in the US only ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)) |

**Why texts are stricter than email.** US law demands written consent for automated marketing texts ([64.1200(a)(2)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)). WhatsApp, which most Latin American and many Caribbean customers prefer, demands an opt-in everywhere ([Meta](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in)). Where a country has no anti-spam law, we use the sensible default: get consent, say who you are, and honor opt-outs.

**Informational messages are different.** A reply to a lead who just filled in a form, a text back after a missed call, or an appointment reminder isn't marketing. In the US it still needs the person's prior express consent if it's automated, which normally means they gave you the number to be contacted ([64.1200(a)(1)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)). The software keeps these first replies plain: no offers, your business name, and how to stop. Anything promotional after that follows the marketing rules.

### 2. It respects quiet hours

Automated texts and calls go out only inside the contact's local window (`quietHours`), in the contact's own time zone.

| Where | Window | Why |
|---|---|---|
| US | 10:00–18:00 | The narrowest window that fits every state on weekdays. Kentucky allows sales calls only from 10am ([KRS 367.46955](https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=48885)). Rhode Island stops at 6pm on weekdays and 5pm on Saturdays ([R.I. 5-61-2](https://webserver.rilegislature.gov/Statutes/TITLE5/5-61/5-61-2.htm)). Pennsylvania has stopped at 7pm since 18 October 2026 ([PA TRA](https://www.legis.state.pa.us/WU01/LI/LI/US/HTM/1996/0/0147..HTM)). See the [state table](#state-laws-that-are-stricter). |
| Canada | 10:00–18:00 | CRTC telemarketing hours are 9:00–21:30 on weekdays and 10:00–18:00 on weekends ([CRTC](https://crtc.gc.ca/eng/phone/telemarketing/tobligations/rules-regles.htm)), so 10–18 works every day. |
| Guadeloupe, Martinique, Saint-Barthélemy, Saint-Martin, Saint-Pierre-et-Miquelon | 10:00–20:00, weekdays | French rules allow sales calls only Monday–Friday, 10:00–13:00 and 14:00–20:00 ([DGCCRF](https://www.economie.gouv.fr/dgccrf/faq-pour-les-professionnels-sur-lencadrement-des-jours-horaires-et-frequence-du-demarchage)). |
| Everywhere else | 9:00–20:00 | No legal hours were found for marketing, so this is a courteous default. |

The window alone can't express every rule, so also do this:
- **Skip Sundays and public holidays in the US.** Pennsylvania, Rhode Island and Mississippi ban sales calls on Sundays, and Texas allows them only from noon ([PA](https://www.legis.state.pa.us/WU01/LI/LI/US/HTM/1996/0/0147..HTM), [RI](https://webserver.rilegislature.gov/Statutes/TITLE5/5-61/5-61-3.6.htm), [MS](https://billstatus.ls.state.ms.us/documents/2024/html/HB/1300-1399/HB1350SG.htm), [TX](https://statutes.capitol.texas.gov/Docs/BC/htm/BC.301.htm)).
- **In the French territories, call only Monday to Friday, never 13:00–14:00, and no more than 4 times in 30 days** ([DGCCRF](https://www.economie.gouv.fr/dgccrf/faq-pour-les-professionnels-sur-lencadrement-des-jours-horaires-et-frequence-du-demarchage)).
- **Make no more than 3 sales calls or texts to one person in 24 hours** (Florida, Oklahoma, Maryland and Oregon cap it there: [FL](https://www.flsenate.gov/Laws/Statutes/2026/Chapter501/All), [OK](https://law.justia.com/codes/oklahoma/title-15/section-15-775c-4/), [MD](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-4502), [OR](https://olis.oregonlegislature.gov/liz/2025r1/Downloads/MeasureDocument/HB3865/Enrolled)).

**One exception: replying to someone who just reached out.** Quiet hours are for messages you start. When a lead fills in a form at 10pm or a caller hangs up after a missed call, the software sends one immediate, non-promotional reply ("Thanks, we got your message, we'll call you tomorrow. Reply STOP to opt out"). Follow-ups wait for the window. The federal hour limit applies to "telephone solicitations", which don't include a call or message to someone with their prior express invitation or permission ([64.1200(f)](https://www.law.cornell.edu/cfr/text/47/64.1200)). State limits mostly target unsolicited sales calls too ([R.I. 5-61-3.6](https://webserver.rilegislature.gov/Statutes/TITLE5/5-61/5-61-3.6.htm)). Still, keep that first reply plain so it can't be read as a sales pitch.

### 3. It handles opt-outs everywhere, at once

- **Words.** Any reply that matches `UNIVERSAL_OPT_OUT` (STOP, QUIT, END, REVOKE, OPT OUT, CANCEL, UNSUBSCRIBE, plus STOPALL, STOP ALL, OPTOUT, OPT-OUT and UNSUB) or the country's local words (Spanish ALTO, BAJA, CANCELAR, PARAR, DETENER; French ARRÊT, DÉSABONNER; Dutch STOPPEN, AFMELDEN; and others) stops marketing to that contact. The first seven are the words the FCC says always revoke consent ([64.1200(a)(10)](https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls)). Treat plain-language requests ("please don't text me again") as opt-outs too: unless every text names reply-STOP as your official method, the FCC requires honoring any reasonable request ([64.1200(a)(11)](https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls)).
- **Speed.** The software stops at once. The legal limits are 10 business days in the US and Canada ([FCC](https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls), [FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), [CRTC](https://crtc.gc.ca/eng/archive/2012/2012-548.htm)).
- **Scope.** An opt-out from a marketing message stops all marketing from that business, by text, call and email. The FCC rule says a marketing opt-out covers all future marketing calls and texts from that caller ([FCC 26-67](https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls)).
- **One confirmation.** It sends a single "You're unsubscribed" text with no marketing in it, within 5 minutes, which the FCC allows ([64.1200(a)(12)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)).
- **Every message says how to stop.** In the US, naming at least one of the standard words in each text ("Reply STOP to opt out") lets you make reply-STOP your official opt-out method from 25 November 2026 ([FCC 26-67](https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls)). Emails carry an unsubscribe link and the business's postal address.
- **Opt-outs are kept for good.** Virginia now requires honoring a STOP for 10 years ([Va. Code 59.1-514](https://law.lis.virginia.gov/vacode/59.1-514/)), so the software never re-subscribes someone without a new, recorded opt-in.

### 4. It doesn't gate or reward reviews

The software sends the same review request to every customer, with a direct link to the review site. It never asks "how did we do?" first and sends only happy customers to Google, and it never offers a discount or entry in a draw for a review.
- Google bans "selectively soliciting positive reviews", discouraging negative ones, and incentives to post, change or remove reviews. Profiles that break the rules can have reviews removed or be blocked from new ones ([Google policy](https://support.google.com/contributionpolicy/answer/7400114), [Google tips](https://support.google.com/business/answer/3474122)).
- In the US, the FTC's rule (in force since 21 October 2024) bans buying reviews, incentives conditioned on a positive (or negative) review, fake and insider reviews, and suppressing negative reviews ([16 CFR 465](https://www.ecfr.gov/current/title-16/part-465), [465.4](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465/section-465.4), [FTC Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)). The FTC's Endorsement Guides use review gating as an example of a practice that can be deceptive ([16 CFR 255.2](https://www.ecfr.gov/current/title-16/section-255.2)).
- In Canada, the Competition Bureau treats fake reviews, and reviews by staff that don't disclose the connection, as misleading advertising ([Competition Bureau](https://www.canada.ca/en/competition-bureau/news/2024/01/online-reviews-posted-by-employees-businesses-could-be-liable.html)).

**Referrals.** Asking a happy customer to refer friends is fine. Don't text the friend's number yourself unless the friend has consented. Give the customer a link or message to forward instead. Under US and Canadian law, the consent has to come from the person you message ([64.1200(f)(9)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200), [CASL](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-2.html)).

### 5. Its AI agent tells the truth about being an AI

The voice agent always answers truthfully when asked whether it's a person. We recommend also saying so in the greeting ("Hi, this is the AI assistant for Smith Plumbing"), which some laws require:
- **US.** AI-generated voices are "artificial" voices under the TCPA, so outbound AI calls need consent and must name the business at the start ([FCC 24-17](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf), [64.1200(b)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)).
- **California** bans bots that hide that they're bots to sell to people online ([B&P 17941](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17941)).
- **Utah** requires a business using generative AI with consumers to disclose it isn't human when asked, and gives a safe harbor for disclosing at the outset ([Utah 13-75-103 and -104](https://le.utah.gov/Session/2025/bills/static/SB0226.html)).
- **Maine** bans AI chatbots in trade that could mislead a reasonable consumer into thinking they're talking to a human, unless the consumer is told ([10 M.R.S. 1500-DD](https://legislature.maine.gov/statutes/10/title10sec1500-DD.html)).
- **Guadeloupe, Martinique and Saint-Martin** are in the EU, where the AI Act's duty to tell people they're dealing with an AI has applied since 2 August 2026 ([Goodwin](https://www.goodwinlaw.com/en/insights/publications/2026/08/alerts-technology-dpc-eu-ai-act-transparency-obligations-now-in-force)).

### 6. It keeps proof

For every contact the software records when, where and how consent was given (the form, the exact wording shown, the number or address), and every opt-out. US lawsuits under the TCPA allow $500 to $1,500 per message ([47 U.S.C. 227(b)(3)](https://www.law.cornell.edu/uscode/text/47/227)) and usually turn on whether you can prove consent.

---

## Key dates

| Date | What happened |
|---|---|
| 1 Sep 2023 | Twilio blocks all texts from unregistered US 10DLC numbers ([Twilio](https://www.twilio.com/en-us/changelog/-u-s--a2p-10dlc--full-blocking-of-traffic-sent-from-unregistered)) |
| 31 Jan 2024 | Unverified toll-free numbers can no longer text the US or Canada ([Twilio](https://twilio.com/en-us/changelog/messaging-on-u-s--toll-free-phone-numbers-pending-verification-i)) |
| Feb 2024 | FCC rules that AI-generated voices are "artificial" under the TCPA (FCC 24-17, adopted 2 Feb) ([FCC](https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices)) |
| 4 Apr 2024 | The FCC's one-confirmation-text rule takes effect ([89 FR 15756](https://www.govinfo.gov/content/pkg/FR-2024-03-05/html/2024-04587.htm)) |
| 21 Oct 2024 | FTC rule on consumer reviews takes effect ([FTC](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)) |
| 24 Jan 2025 | The Eleventh Circuit vacates the FCC's one-to-one consent rule days before it was due to start ([opinion](https://media.ca11.uscourts.gov/opinions/pub/files/202410277.pdf)) |
| 21 Mar 2025 | Mexico's new data protection law (LFPDPPP) takes effect ([Garrigues](https://www.garrigues.com/es_ES/noticia/mexico-nueva-ley-federal-proteccion-datos-personales-posesion-particulares-introduce)) |
| 11 Apr 2025 | FCC revocation rules take effect: revoke by any reasonable means, the seven words, 10 business days. The "revoke all" part is delayed ([FR](https://www.federalregister.gov/documents/2024/10/11/2024-23605/strengthening-the-ability-of-consumers-to-stop-robocalls), [DA 25-312](https://docs.fcc.gov/public/attachments/DA-25-312A1.pdf)) |
| 1 Jul 2025 | WhatsApp moves to per-message pricing ([Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)) |
| Jul–Aug 2025 | FCC removes the vacated one-to-one text from its rules (DA 25-621) ([FR](https://www.govinfo.gov/content/pkg/FR-2025-08-29/html/2025-16641.htm)) |
| 1 Sep 2025 | Texas treats marketing texts as telephone solicitations (SB 140) ([Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages)) |
| 1 Jan 2026 | Oregon (HB 3865) and Virginia (SB 1339) changes take effect ([OR](https://olis.oregonlegislature.gov/liz/2025r1/Downloads/MeasureDocument/HB3865/Enrolled), [VA](https://law.lis.virginia.gov/vacode/59.1-514/)) |
| 6 Jan 2026 | FCC delays "revoke all" again, to 31 Jan 2027 ([DA 26-12](https://docs.fcc.gov/public/attachments/DA-26-12A1.pdf)) |
| 11 Jun 2026 | CRTC opens a review of Canada's telemarketing rules, including whether AI voices count as automatic dialing-announcing devices ([CRTC 2026-132](https://crtc.gc.ca/eng/archive/2026/2026-132.htm)) |
| Jun 2026 | Canada tables Bill C-36, a new federal privacy law (not yet passed) ([DLA Piper](https://www.dlapiper.com/en/insights/publications/2026/06/canada-tables-bill-c36-the-protecting-privacy-and-consumer-data-act)) |
| 2 Aug 2026 | EU AI Act transparency duties apply in Guadeloupe, Martinique and Saint-Martin ([Goodwin](https://www.goodwinlaw.com/en/insights/publications/2026/08/alerts-technology-dpc-eu-ai-act-transparency-obligations-now-in-force)) |
| 11 Aug 2026 | France requires prior consent for sales calls, and Bloctel ends ([DGCCRF](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/renforcement-des-mesures-pour-lutter-contre-le-demarchage-abusif)) |
| 1 Oct 2026 | WhatsApp starts charging for utility and service messages inside the 24-hour window, beyond a free allowance ([Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)) |
| 7–8 Oct 2026 | Mexico's Senate approves much higher fines for unauthorized sales calls and messages; the Chamber of Deputies hasn't voted yet ([Infobae](https://www.infobae.com/mexico/2026/10/07/senado-aprueba-reforma-para-sancionar-llamadas-comerciales-sin-consentimiento-multas-superarian-23-millones-de-pesos/)) |
| 18 Oct 2026 | Pennsylvania's Act 47 takes effect: texts covered, no sales calls or texts on Sundays or outside 9am–7pm ([NLR](https://natlawreview.com/article/pennsylvania-expands-telemarketing-law-cover-text-messages-ringless-voicemails-and)) |
| **25 Nov 2026** | **FCC's revised revocation rules take effect** and replace the delayed "revoke all" rule ([FCC 26-67](https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls)) |

---

## United States

### Email: CAN-SPAM

CAN-SPAM covers every email whose main purpose is to advertise, including email to past customers. It doesn't require consent before you send ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), [16 CFR 316](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316)). Every marketing email must:
- have accurate From, To and Reply-To details and a subject line that matches the content;
- say clearly that it's an ad;
- include the business's valid postal address (a street address, PO box or registered private mailbox);
- explain clearly how to opt out, by reply email or a single web page, with no fee, login or extra personal details required.

Honor opt-outs within 10 business days, keep the opt-out mechanism working for at least 30 days after sending, and never sell or share an opted-out address. Penalties are up to $53,088 per email, and the business being promoted is liable even when an agency sends the email ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).

Receipts, appointment confirmations and other transactional emails are mostly exempt. If the subject line or the opening is promotional, the email counts as marketing ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).

### Texts: TCPA, FCC rules and the carriers

**Consent.** Marketing texts sent with an autodialer, and marketing calls using an artificial or prerecorded voice, need **prior express written consent** ([64.1200(a)(2)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)). That's a written agreement signed by the person (e-signatures count) that:
- clearly authorizes the seller to send marketing texts or calls with automated technology;
- gives the number to be used;
- says the person doesn't have to agree in order to buy anything ([64.1200(f)(9)](https://www.law.cornell.edu/cfr/text/47/64.1200)).

Informational automated texts need **prior express consent** ([64.1200(a)(1)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)). The FCC treats texts as calls, and the do-not-call rules expressly cover texts to cell phones ([64.1200(e)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)).

**The one-to-one consent rule never took effect.** In 2023 the FCC said one consent could name only one seller. The Eleventh Circuit vacated that rule on 24 January 2025 ([Insurance Marketing Coalition v. FCC](https://media.ca11.uscourts.gov/opinions/pub/files/202410277.pdf)). In July 2025 the FCC restored the earlier definition (DA 25-621, published 29 August 2025) ([Federal Register](https://www.govinfo.gov/content/pkg/FR-2025-08-29/html/2025-16641.htm), [DA 25-621](https://docs.fcc.gov/public/attachments/DA-25-621A1.pdf)). A lead form may again name several sellers, but each must be clearly identified.

**Revoking consent, step by step:**
1. **2024 order (FCC 24-24).** People can revoke consent by any reasonable means. A reply of "stop", "quit", "end", "revoke", "opt out", "cancel" or "unsubscribe" always counts. Requests must be honored within 10 business days, and one confirmation text is allowed ([FCC 24-24](https://docs.fcc.gov/public/attachments/FCC-24-24A1.pdf)).
2. **Effective dates.** The confirmation-text rule took effect on 4 April 2024 ([89 FR 15756](https://www.govinfo.gov/content/pkg/FR-2024-03-05/html/2024-04587.htm)). The rest took effect on 11 April 2025 ([Federal Register](https://www.federalregister.gov/documents/2024/10/11/2024-23605/strengthening-the-ability-of-consumers-to-stop-robocalls)).
3. **The delayed part.** The "revoke all" rule says an opt-out from one kind of message stops every message from that business. It was delayed to 11 April 2026 ([DA 25-312](https://docs.fcc.gov/public/attachments/DA-25-312A1.pdf)) and then to 31 January 2027 ([DA 26-12](https://docs.fcc.gov/public/attachments/DA-26-12A1.pdf)).
4. **The 2026 revision (FCC 26-67, effective 25 November 2026)** replaces it ([Federal Register](https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls)):
   - An opt-out from an informational message may be limited to that kind of message. An opt-out from a marketing message stops **all** future marketing calls and texts from the business.
   - A business may name one official opt-out method: an automated key-press or voice option on calls, a reply with the standard words to texts, or a website or phone number. It must state that method clearly in every call or text. Texts only need to mention one standard word, but every standard word must still work. A business that doesn't name a method must honor any reasonable request.
   - The 10-business-day limit and the confirmation text within 5 minutes stay.
   - If your texting system can't receive replies, every text must say so and give another way to opt out.

**Registration with the carriers.** Texts from US local numbers need A2P 10DLC brand and campaign registration. Twilio has blocked all unregistered US 10DLC traffic since 1 September 2023 ([Twilio](https://www.twilio.com/en-us/changelog/-u-s--a2p-10dlc--full-blocking-of-traffic-sent-from-unregistered), [Twilio support](https://support.twilio.com/hc/en-us/articles/14910496447771-Shutdown-of-Unregistered-10DLC-Messaging)). Toll-free numbers need toll-free verification, and unverified ones have been blocked from texting the US and Canada since 31 January 2024 ([Twilio](https://twilio.com/en-us/changelog/messaging-on-u-s--toll-free-phone-numbers-pending-verification-i)). Registration asks for your opt-in wording, sample messages and opt-out handling, so set those up before applying.

**Lead replies and missed-call texts.** These answer a person who just contacted the business. Keep the first reply informational, name the business and say how to stop. Treat anything promotional after that as marketing, which needs written consent. A website form that collects phone numbers should include written-consent wording and an unchecked checkbox. The form should also say that consent isn't required to buy ([64.1200(f)(9)](https://www.law.cornell.edu/cfr/text/47/64.1200)).

### Calls and AI voices

- **AI voices are "artificial" voices.** In February 2024 the FCC ruled that the TCPA's limits on "artificial or prerecorded voice" calls cover AI technologies that generate human voices, including voice cloning ([FCC 24-17](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf), [FCC](https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices)).
  - An outbound AI call needs prior express written consent if it's marketing, and prior express consent otherwise ([64.1200(a)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)).
  - It must name the business at the start and give a callback number. A marketing call must also offer an automated opt-out ([64.1200(b)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)).
  - The rules on artificial voices apply to calls you make, not to your AI agent answering calls people make to you.
- **Courts may read the TCPA for themselves.** Since June 2025, federal courts aren't bound by the FCC's reading of the TCPA ([McLaughlin Chiropractic v. McKesson](https://www.supremecourt.gov/opinions/24pdf/23-1226_1a72.pdf)). Still, follow the FCC's AI-voice ruling: it's the regulator's position and the cautious reading.
- **Do Not Call.** Don't make sales calls or texts to numbers on the National Do Not Call Registry or on your own do-not-call list. Use a copy of the registry no more than 31 days old ([64.1200(c)(2)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)).
  - There's an exception for an established business relationship: a purchase in the last 18 months or an inquiry in the last 3 months ([64.1200(f)(5)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)).
  - That exception doesn't cover automated or artificial-voice marketing calls to cell phones. Those still need written consent.
- **Hours.** Federal law bars telephone solicitations before 8am or after 9pm in the called person's time zone ([64.1200(c)(1)](https://www.ecfr.gov/current/title-47/part-64/section-64.1200)). Several states are stricter (below).
- **Pending.** In 2024 the FCC proposed requiring callers to disclose AI-generated calls ([Federal Register](https://www.federalregister.gov/documents/2024/09/10/2024-19028/implications-of-artificial-intelligence-technologies-on-protecting-consumers-from-unwanted-robocalls)). We found no final rule.

### State laws that are stricter

These are the strictest common state rules. The US quiet-hours default (10:00–18:00) fits all of them on weekdays.

| State | Sales-call hours (called person's time) | Other limits | Source |
|---|---|---|---|
| Kentucky | 10am–9pm | | [KRS 367.46955(16)](https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=48885) |
| Rhode Island | Mon–Fri 9am–6pm, Sat 10am–5pm, never Sundays or holidays | | [5-61-2](https://webserver.rilegislature.gov/Statutes/TITLE5/5-61/5-61-2.htm), [5-61-3.6](https://webserver.rilegislature.gov/Statutes/TITLE5/5-61/5-61-3.6.htm) |
| Pennsylvania (from 18 Oct 2026) | 9am–7pm, never Sundays | Texts now covered. STOP, QUIT, END, REVOKE, OPT OUT, CANCEL and UNSUBSCRIBE must be honored | [Act 47](https://www.legis.state.pa.us/WU01/LI/LI/US/HTM/1996/0/0147..HTM), [NLR](https://natlawreview.com/article/pennsylvania-expands-telemarketing-law-cover-text-messages-ringless-voicemails-and) |
| Connecticut | 9am–8pm | | [42-288a](https://www.cga.ct.gov/Current/pub/chap_743m.htm) |
| Florida | 8am–8pm | At most 3 sales calls from any number in 24 hours. Written consent for automated sales calls and texts. Before suing over texts, a person must reply STOP and give you 15 days | [501.616](https://www.flsenate.gov/Laws/Statutes/2026/Chapter501/All), [501.059](https://www.flsenate.gov/Laws/Statutes/2026/501.059) |
| Oklahoma | 8am–8pm | At most 3 calls in 24 hours. Written consent for automated sales calls | [775C.4](https://law.justia.com/codes/oklahoma/title-15/section-15-775c-4/), [775C.3](https://law.justia.com/codes/oklahoma/title-15/section-15-775c-3/) |
| Maryland | 8am–8pm | At most 3 times in 24 hours on the same subject. Written consent for automated sales calls and texts | [14-4502](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-4502) |
| Washington | 8am–8pm | Commercial texts need clear, affirmative advance consent | [RCW 80.36.390](https://app.leg.wa.gov/RCW/default.aspx?cite=80.36.390), [RCW 19.190.070](https://app.leg.wa.gov/RCW/default.aspx?cite=19.190.070) |
| Oregon (from 1 Jan 2026) | 8am–8pm | At most 3 in 24 hours, unless you have an established business relationship. Texts covered | [HB 3865](https://olis.oregonlegislature.gov/liz/2025r1/Downloads/MeasureDocument/HB3865/Enrolled) |
| Texas | Mon–Sat 9am–9pm, Sun noon–9pm | Texts are telephone solicitations since 1 Sep 2025. Text marketers may need to register with the Secretary of State | [ch. 301](https://statutes.capitol.texas.gov/Docs/BC/htm/BC.301.htm), [Morgan Lewis](https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages) |
| Mississippi | Mon–Sat 8am–9pm, never Sundays | | [77-3-603](https://billstatus.ls.state.ms.us/documents/2024/html/HB/1300-1399/HB1350SG.htm) |
| Virginia (from 1 Jan 2026) | Federal hours | Texts covered. A STOP or UNSUBSCRIBE must be honored for 10 years | [Va. Code 59.1-514](https://law.lis.virginia.gov/vacode/59.1-514/) |

Several of these laws let consumers sue. Some, like Texas, also require sellers to register or post a bond. If a client markets heavily into one state, read that state's law.

### Reviews

See [default 4](#4-it-doesnt-gate-or-reward-reviews). The FTC rule doesn't ban every review request with a gift attached. It bans incentives conditioned on a positive or negative review ([465.4](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465/section-465.4)). Google bans review incentives of any kind ([Google](https://support.google.com/business/answer/3474122)). The software follows the stricter rule.

### AI disclosure

See [default 5](#5-its-ai-agent-tells-the-truth-about-being-an-ai). California's bot law covers online interactions meant to sell ([B&P 17941](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17941)). Utah's covers generative AI in consumer transactions and requires disclosure when the consumer asks ([Utah SB 226](https://le.utah.gov/Session/2025/bills/static/SB0226.html)). Maine's covers AI chatbots that could mislead ([Maine](https://legislature.maine.gov/statutes/10/title10sec1500-DD.html)).

### Privacy

There's no general federal privacy law for small businesses. The FTC does pursue businesses that break their privacy promises or protect data carelessly, so say what you collect and why, and protect it ([FTC guide](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business)). Keep consent and opt-out records; see [default 6](#6-it-keeps-proof).

---

## Canada

### Email and texts: CASL

Canada's Anti-Spam Legislation covers every commercial electronic message, including texts ([CASL ss. 6–11](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-2.html), [CRTC FAQ](https://crtc.gc.ca/eng/com500/faq500.htm)). You need consent before you send:
- **Express consent.** The person agreed, and you can prove it. It lasts until they withdraw it.
- **Implied consent from an existing business relationship** ([CRTC guidance](https://crtc.gc.ca/eng/com500/guide.htm)):
  - a purchase or lease from the business in the **2 years** before the message, or
  - an inquiry or application in the **6 months** before it.

  After those windows, implied consent ends unless there's a new purchase or inquiry. Ask for express consent whenever you can.

Every message must ([CRTC 2012-548](https://crtc.gc.ca/eng/archive/2012/2012-548.htm)):
- name the business sending it, and anyone it's sent on behalf of;
- give a mailing address plus a phone number, email or web address, valid for at least 60 days;
- include an unsubscribe mechanism that works for at least 60 days and costs nothing. For texts, a STOP reply or a link to an unsubscribe page works. If the details don't fit in a text, they can sit on a page you link to.

Honor unsubscribes within 10 business days ([CASL s. 11](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-2.html)). Canada has no 10DLC registration, but toll-free numbers must be verified to text ([Twilio](https://twilio.com/en-us/changelog/messaging-on-u-s--toll-free-phone-numbers-pending-verification-i)).

### Calls: the CRTC's Unsolicited Telecommunications Rules

- **Hours.** Sales calls only 9:00–21:30 on weekdays and 10:00–18:00 on weekends, in the called person's time. At the start of the call, say who's calling and why ([CRTC key rules](https://crtc.gc.ca/eng/phone/telemarketing/tobligations/rules-regles.htm)).
- **National Do Not Call List.** Telemarketers must register with the DNCL operator and pay fees ([CRTC](https://crtc.gc.ca/eng/phone/telemarketing/tobligations/register-inscrire.htm)). Don't call numbers on the list unless an exemption applies ([DNCL exemptions](https://lnnte-dncl.gc.ca/en/Organization/Exemptions)):
  - a purchase or lease in the last 18 months;
  - a written contract still in force or ended within 18 months;
  - an inquiry or application in the last 6 months.

  A person's own request not to be called overrides these exemptions. Calls to businesses are exempt from the DNCL rules.
- **Automated and recorded voices.** Sales calls made with an automatic dialing-announcing device (ADAD), meaning a recorded or synthetic voice, need the person's express consent first ([CRTC rules](https://crtc.gc.ca/eng/trules-reglest.htm)). Non-sales ADAD calls, such as appointment reminders, are allowed but must identify the caller and follow the hour limits.
- **AI voices are under review.** In June 2026 the CRTC began consulting on whether the ADAD definition captures AI-generated voices, and on aligning "telemarketing" with CASL ([CRTC 2026-132](https://crtc.gc.ca/eng/archive/2026/2026-132.htm)). Until it decides, treat AI-voice sales calls as ADAD calls and get express consent.

### Privacy

- **Outside Quebec.** Businesses follow PIPEDA (or Alberta's or BC's similar law): get meaningful consent, use data only for the purposes you told people, keep it secure, and let people see it ([OPC](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/)).
- **Quebec's Law 25 adds:**
  - consent that is clear and specific, requested separately;
  - a published privacy policy;
  - a person in charge of protecting personal information (the head of the business by default);
  - reporting serious "confidentiality incidents" to the Commission d'accès à l'information and to the people affected.

  It applies to businesses outside Quebec that handle Quebecers' data ([Quebec P-39.1](https://www.legisquebec.gouv.qc.ca/en/document/cs/p-39.1), [CFIB](https://www.cfib-fcei.ca/en/site/qc-law-25)).
- **Coming.** Bill C-36, tabled in June 2026, would replace PIPEDA's privacy part with a new act and regulator. It isn't law yet ([DLA Piper](https://www.dlapiper.com/en/insights/publications/2026/06/canada-tables-bill-c36-the-protecting-privacy-and-consumer-data-act)).

### Reviews

The Competition Bureau warns that businesses can be liable for misleading reviews, including reviews by employees that don't disclose the connection ([Competition Bureau](https://www.canada.ca/en/competition-bureau/news/2024/01/online-reviews-posted-by-employees-businesses-could-be-liable.html)). We found no Canadian rule specific to review incentives. Google's ban on incentives and gating applies anyway.

---

## Mexico

### Privacy: the 2025 LFPDPPP

A new federal data protection law for private businesses was published on 20 March 2025 and took effect the next day, replacing the 2010 law ([Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), [Garrigues](https://www.garrigues.com/es_ES/noticia/mexico-nueva-ley-federal-proteccion-datos-personales-posesion-particulares-introduce)). The data protection authority, the INAI, was dissolved, and its role passed to the Secretaría Anticorrupción y Buen Gobierno ([EY](https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares)).

In practice ([LFPDPPP](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf)):
- **Privacy notice.** Give an *aviso de privacidad* when you collect data. It says who you are, what you'll use the data for (list marketing separately, so people can refuse it), and how people can exercise their ARCO rights: access, rectification, cancellation and opposition.
- **Consent.** Consent can be tacit for ordinary contact details once the notice is given and the person doesn't object. Get express consent for financial or sensitive data.

### Advertising by email, text and phone: the LFPC and REPEP

- **Name yourself.** Every ad sent to a consumer must show the business's name, address and phone number (or email) ([art. 17](https://mley.mx/LFPC/articulo/17/)).
- **Stop when asked.** Consumers can tell a business to stop contacting them for marketing. Businesses may not send ads to people who said no, or to people on PROFECO's registry ([art. 18 Bis](https://mley.mx/LFPC/articulo/18-bis/), [LFPC](https://www.diputados.gob.mx/LeyesBiblio/ref/lfpc.htm)).
- **REPEP** (*Registro Público para Evitar Publicidad*) is PROFECO's free do-not-advertise list. It covers landlines and mobiles, for sales calls and texts in commerce, services and telecom ([REPEP](https://repep.profeco.gob.mx/)). Check numbers against it before marketing calls or texts.
- **Pending reform.** On 7–8 October 2026 the Senate unanimously approved changes to arts. 18 Bis and 127 that ban repeated, persistent sales contacts without authorization and raise fines to about MXN 2.3 million. The bill now goes to the Chamber of Deputies ([Infobae](https://www.infobae.com/mexico/2026/10/07/senado-aprueba-reforma-para-sancionar-llamadas-comerciales-sin-consentimiento-multas-superarian-23-millones-de-pesos/)).

### Calling hours

We found no calling-hour rule for marketing in Mexico, so the default window is a courteous 9:00–20:00.

### Sending texts in Mexico

Through Twilio ([Twilio Mexico SMS](https://www.twilio.com/en-us/guidelines/mx/sms), [Twilio Mexico regulatory](https://www.twilio.com/en-us/guidelines/mx/regulatory)):
- **Mexican mobile numbers** are for two-way, person-to-person texting only. Carriers block automated (A2P) traffic from them.
- **Domestic long codes** deliver reliably only to AT&T Mexico. Texts to other carriers arrive from random numbers.
- **What Twilio recommends instead:** a pre-registered alphanumeric sender ID (one-way), a dedicated short code, or a +1 number. Support HELP and STOP replies in Spanish, and don't text numbers on do-not-disturb lists.

### WhatsApp first

Messaging is the most common thing Mexicans do online ([INEGI ENDUTIH 2024](https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/endutih/ENDUTIH_24_RR.pdf)), and WhatsApp is the app they use for it: about 91% of Mexican internet users are on it ([El Universal](https://www.eluniversal.com.mx/techbit/que-tan-grande-e-importante-es-whatsapp-en-mexico)). That's why `src/lib/markets.ts` marks Mexico `whatsappFirst`. Use WhatsApp as the main channel there (it needs an opt-in and approved templates, below) and SMS as the fallback.

---

## WhatsApp Business Platform (everywhere)

- **Opt-in.** Before messaging someone, get their opt-in, and make clear they're agreeing to messages from your business. The opt-in can come from a website form, a text or a WhatsApp thread, and you must honor requests to stop ([Meta opt-in](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in), [policy](https://business.whatsapp.com/policy)).
- **The 24-hour window.** Each time a customer messages you, a 24-hour customer-service window opens, and you can reply freely inside it. Outside it, you can only send pre-approved **templates** ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
- **Template categories** ([Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)):
  - **marketing:** offers, win-back, review and referral asks;
  - **utility:** updates on something the customer did or asked for;
  - **authentication:** one-time codes.

  Meta treats a template that mixes utility and promotion as marketing.
- **Pricing.**
  - Since **1 July 2025**, Meta charges per delivered template message, by category and the recipient's country ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
  - Since **1 October 2026**, utility messages sent inside an open window are billed too. Service replies are billed beyond a free tier of 1,000 per business number per month ([Meta updates](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)).
  - Conversations started from Click-to-WhatsApp ads or Facebook call-to-action buttons open a free window ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
- **US numbers.** Since April 2025, Meta hasn't delivered marketing templates to US (+1) numbers. As of November 2026 the pause is reported to still be in place ([WATI](https://www.wati.io/en/blog/whatsapp-marketing-messages-us-2026/)). Utility and authentication templates and customer-initiated chats still work, and Canadian numbers aren't affected.

---

## Google reviews (everywhere)

Google's policy for Maps and Business Profile reviews ([Google](https://support.google.com/contributionpolicy/answer/7400114)):
- Don't discourage or prohibit negative reviews, and don't **selectively solicit positive reviews**. That rules out review gating.
- Don't offer incentives such as discounts, free goods or services, or money to post, change or remove reviews ([tips page](https://support.google.com/business/answer/3474122)).
- You may ask every customer to leave an honest review, without trying to influence the rating or the content.

Profiles that break the rules can have reviews removed, be blocked from new reviews for a time, or show a warning that fake reviews were removed ([Google](https://support.google.com/business/answer/14114287)).

---

## Other countries and territories

"Sensible default" means: get consent (an opt-in for texts and WhatsApp; an existing relationship for email), name your business in every message, honor opt-outs at once, and call only between 9:00 and 20:00. "Texts / Email" give the data file's `smsConsent` / `emailConsent`.

| Country | Marketing messages | Data protection law | Texts / Email · hours | Sources |
|---|---|---|---|---|
| Guatemala | No anti-spam or telemarketing law found. Sensible default | None yet. Bills in Congress; habeas data through the courts | opt-in / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=GT&t=law), [IAPP](https://iapp.org/news/b/data-protection-law-initiative-advances-in-guatemala) |
| Belize | No anti-spam law found. Sensible default | Data Protection Act 2021 passed. Starts on a date the Minister sets; no commissioner reported | opt-in / relationship · 9–20 | [Act No. 45 of 2021](https://www.nationalassembly.gov.bz/wp-content/uploads/2021/12/Act-No-45-of-2021-Data-Protection-Act.pdf), [DataGuidance](https://www.dataguidance.com/jurisdiction/belize) |
| El Salvador | No anti-spam law found. The data law governs marketing use, so get consent | Personal Data Protection Law (Decree 144), in force Nov 2024, supervised by the State Cybersecurity Agency | opt-in / opt-in · 9–20 | [Decree 144](https://www.refworld.org/sites/default/files/2025-01/14871.pdf), [El Mundo](https://diario.elmundo.sv/politica/vigentes-leyes-de-datos-personales-y-ciberseguridad-organizaciones-temen-por-libertad-de-expresion) |
| Honduras | No anti-spam law found. Sensible default | None. A draft hasn't been enacted | opt-in / relationship · 9–20 | [DataGuidance](https://www.dataguidance.com/jurisdiction/honduras), [DLA Piper](https://www.dlapiperdataprotection.com/?c=HN&t=law) |
| Nicaragua | No anti-spam law found. Law 787 needs consent, so get it | Law 787 (2012) with access, correction and deletion rights. Its supervisory office was never fully set up | opt-in / opt-in · 9–20 | [Ley 787](https://nicaragua.justia.com/nacionales/leyes/ley-de-proteccion-de-datos-personales-mar-29-2012/gdoc), [DLA Piper](https://www.dlapiperdataprotection.com/?c=NI&t=law) |
| Costa Rica | Telecom law 8642 bans email, automated calls, fax and similar tools for direct sales without prior consent. People can block sales calls | Ley 8968 (2011): informed consent, supervised by PRODHAB | opt-in / opt-in · 9–20 | [Ley 8642](https://www.sutel.go.cr/sites/default/files/normativas/ley_general_de_telecomunicaciones.pdf), [Tico Times](https://ticotimes.net/2013/01/28/phone-customers-can-now-block-annoying-sales-calls), [Ley 8968](https://www.archivonacional.go.cr/web/normativa/ley8968.docx), [Lex Mundi](https://www.lexmundi.com/guides/global-data-privacy-guide/jurisdictions/latin-america-caribbean/costa-rica) |
| Panama | No anti-spam law found. Law 81 requires prior, informed consent to process data, so get consent | Law 81 of 2019 (in force Mar 2021) and Executive Decree 285 of 2021, supervised by ANTAI | opt-in / opt-in · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?t=law&c=PA), [ANTAI guide](https://www.antai.gob.pa/wp-content/uploads/2024/01/GUIA-SECTOR-PRIVADO-1.pdf) |
| Cuba | No anti-spam law found. Law 149 needs consent | Law 149 (published Aug 2022, in force 2023), supervised by the Ministry of Justice | opt-in / opt-in · 9–20 | [DataGuidance](https://www.dataguidance.com/jurisdiction/cuba), [MINCOM](https://www.mincom.gob.cu/es/print/5823) |
| Jamaica | Direct marketing only with consent or to existing customers. People can make you stop | Data Protection Act 2020, fully in force since Dec 2023, with an Information Commissioner | relationship / relationship · 9–20 | [Act](https://japarliament.gov.jm/attachments/article/339/The%20Data%20Protection%20Act,%202020.pdf), [Chambers](https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/jamaica) |
| Haiti | No anti-spam law found. Sensible default | None comprehensive. The Penal Code punishes processing data in breach of legal formalities | opt-in / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=HT&t=law) |
| Dominican Republic | Law 310-14 requires the recipient's consent for commercial email unless an exception applies | Law 172-13 (2013): consent, plus access, correction, objection and deletion rights | opt-in / opt-in · 9–20 | [Ley 310-14](https://wp.ogtic.gob.do/wp-content/uploads/2019/02/Ley-310-14.pdf), [DLA Piper](https://www.dlapiperdataprotection.com/?c=DO&t=law), [Ley 172-13](https://phlaw.com/ley-172-13-sobre-proteccion-de-datos-personales/) |
| Bahamas | No anti-spam law found. People can forbid direct marketing (including email) | Data Protection Act 2003 | relationship / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=BS&t=law) |
| Barbados | No anti-spam law found. People can object to direct marketing, and you must stop | Data Protection Act 2019 (in force 2021, some parts not yet proclaimed) | relationship / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=BB&t=law), [Barbados Today](https://barbadostoday.bb/2024/07/16/uncovering-your-rights-what-customers-employees-should-know-about-the-data-protection-act-2019) |
| Trinidad and Tobago | No anti-spam law found. Sensible default | Data Protection Act 2011, only partly in force (the general principles, not the enforcement parts) | opt-in / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=TT&t=law), [UWI](https://uwi.edu/data-protection/pg-external_tt.php) |
| Antigua and Barbuda | No anti-spam law found. The data law builds on consent, so get it | Data Protection Act 2013, with the Information Commissioner (activity unclear) | opt-in / opt-in · 9–20 | [UWI](https://uwi.edu/data-protection/pg-external_antiguabarbuda.php) |
| Dominica | No anti-spam law found. Sensible default | None as of Feb 2025 (an OECS model law is being developed) | opt-in / relationship · 9–20 | [UWI](https://www.uwi.edu/data-protection/?q=resources-external-dominica) |
| Grenada | No anti-spam law found. Sensible default | Data Protection Act No. 1 of 2023 enacted. No commencement date found | opt-in / relationship · 9–20 | [UWI](https://uwi.edu/data-protection/pg-external_grenada.php), [DataGuidance](https://www.dataguidance.com/jurisdiction/grenada) |
| St Kitts and Nevis | No anti-spam law found. Sensible default | Data Protection Act 2018 passed, not in force as of Feb 2025 | opt-in / relationship · 9–20 | [UWI](https://www.uwi.edu/data-protection/?q=resources-external-skn) |
| St Lucia | No anti-spam law found. Sensible default | Data Protection Act partly in force since Jan 2023. Rights and enforcement still pending | opt-in / relationship · 9–20 | [UWI](https://www.uwi.edu/data-protection/?q=resources-external-slu) |
| St Vincent and the Grenadines | No anti-spam law found. Sensible default | None for businesses (the Privacy Act 2003 covers only public bodies and isn't in force) | opt-in / relationship · 9–20 | [UWI](https://uwi.edu/data-protection/pg-external_svg.php) |
| Cayman Islands | No anti-spam law found. People can tell you to stop direct marketing at any time, and you can't refuse | Data Protection Act (2021 Revision), in force since 2019, enforced by the Ombudsman | relationship / relationship · 9–20 | [Ombudsman](https://ombudsman.ky/images/pdf/guide/91-the-right-to-stop-direct-marketing.pdf), [Act](https://www.ombudsman.ky/images/pdf/laws_regs/Data_Protection_Act_2021_Rev.pdf) |
| Bermuda | No anti-spam law found. People can ask you to stop, or not start, marketing to them (PIPA s. 19) | PIPA 2016, fully in force since 1 Jan 2025, enforced by the Privacy Commissioner | relationship / relationship · 9–20 | [Conyers](https://www.conyers.com/publications/view/direct-marketing-in-bermuda-what-businesses-need-to-know-in-2026/), [PrivCom](https://www.privacy.bm/post/official-date-of-full-pipa-implementation-announced) |
| Turks and Caicos | No anti-spam law found. Sensible default | None comprehensive as of Feb 2025 | opt-in / relationship · 9–20 | [UWI](https://uwi.edu/data-protection/pg-external_tci.php) |
| British Virgin Islands | No anti-spam law found. People can require you in writing to stop, or not begin, direct marketing | Data Protection Act 2021, in force since 9 Jul 2021 | relationship / relationship · 9–20 | [Act](https://laws.gov.vg/sites/default/files/2021-12/No.%203%20of%202021-Data%20Protection%20Act,%202021.pdf), [Appleby](https://applebyglobal.com/publications/data-protection-guide-british-virgin-islands) |
| Anguilla | No anti-spam law found. Sensible default | None comprehensive as of Feb 2025 | opt-in / relationship · 9–20 | [UWI](https://uwi.edu/data-protection/pg-external_anguilla.php) |
| Montserrat | No anti-spam law found. Sensible default | None comprehensive as of Feb 2025 | opt-in / relationship · 9–20 | [UWI](https://uwi.edu/data-protection/pg-external_montserrat.php) |
| Aruba | No anti-spam law found. Sensible default | Landsverordening persoonsregistraties, an older law modeled on a former Dutch act | opt-in / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=AW&t=law) |
| Curaçao | No electronic-marketing rules. Sensible default | Landsverordening bescherming persoonsgegevens (2010). The Dutch privacy authority warned of weak oversight in June 2026 | opt-in / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=CW&t=law), [Curaçao Chronicle](https://www.curacaochronicle.com/post/local/dutch-privacy-authority-warns-curacao-lacks-effective-data-protection-oversight) |
| Sint Maarten | No anti-spam law found. Sensible default | Landsverordening bescherming persoonsgegevens (2010) | opt-in / relationship · 9–20 | [DLA Piper](https://www.dlapiperdataprotection.com/?c=SX&t=law) |
| Bonaire, Sint Eustatius, Saba | No anti-spam rule found. Sensible default | Wet bescherming persoonsgegevens BES (2010), not the GDPR. The CBP BES has few powers | opt-in / relationship · 9–20 | [Wbp BES](https://zoek.officielebekendmakingen.nl/stb-2010-349.pdf), [DLA Piper](https://www.dlapiperdataprotection.com/?t=law&c=BQ) |
| Guadeloupe, Martinique, Saint-Martin (EU) | Opt-in for marketing email and texts to individuals (CPCE L34-5), with an exception for existing customers buying similar products who could refuse. Since 11 Aug 2026, sales calls need prior consent (Bloctel has ended). Calls only Mon–Fri 10–13 and 14–20, max 4 in 30 days | GDPR in full, supervised by the CNIL. EU AI Act disclosure since 2 Aug 2026 | opt-in / opt-in · 10–20, weekdays | [CNIL](https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel), [CNIL clients](https://www.cnil.fr/fr/communication-electronique-quelles-regles), [DGCCRF consent](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/renforcement-des-mesures-pour-lutter-contre-le-demarchage-abusif), [Préfecture](https://www.prefectures-regions.gouv.fr/normandie/Actualites/Depuis-le-11-aout-sans-accord-prealable-le-demarchage-telephonique-est-interdit), [DGCCRF hours](https://www.economie.gouv.fr/dgccrf/faq-pour-les-professionnels-sur-lencadrement-des-jours-horaires-et-frequence-du-demarchage), [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) |
| Saint-Barthélemy, Saint-Pierre-et-Miquelon (French, outside the EU) | The French rules above apply | France's data protection law applies, giving effect to GDPR rules with local adaptations | opt-in / opt-in · 10–20, weekdays | [CNIL outre-mer](https://www.cnil.fr/fr/comment-la-loi-informatique-et-libertes-sapplique-t-elle-loutre-mer), [CNIL](https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel), [DGCCRF](https://www.economie.gouv.fr/dgccrf/faq-pour-les-professionnels-sur-lencadrement-des-jours-horaires-et-frequence-du-demarchage) |
| Greenland | No Greenlandic anti-spam rule confirmed. A marketing act modeled on Danish law was before Inatsisartut in 2026. Use the Danish opt-in standard | Its own version of Denmark's data protection act (since 1 Dec 2016), supervised by the Danish Data Protection Agency. The GDPR doesn't apply | opt-in / opt-in · 9–20 | [DataGuidance](https://www.dataguidance.com/jurisdiction/greenland), [bill FM2026/26](https://ina.gl/media/kaybnx3z/pkt26_fm2026_markedsfoeringsloven_bem_da.pdf), [Danish spam guide](https://forbrugerombudsmanden.dk/media/bjajzdv1/vejledning-om-spamforbuddet-2021-a.pdf) |

---

## What we couldn't confirm

Re-check these before relying on them:
- **State hour rules and texts.** Kentucky's, Rhode Island's and Mississippi's hour limits are written for sales calls. We apply them to texts too, to be safe.
- **Pennsylvania's Act 47.** The effective date (18 October 2026) and the opt-out word list come from law-firm summaries. The new hours (9am–7pm, no Sundays) are from the official consolidated text.
- **WhatsApp.** The 1 October 2026 pricing change and the 1,000 free service messages come from Meta's pricing pages; check current rates there. The pause on marketing templates to US numbers is reported by vendors as still in effect; we didn't find a Meta announcement ending it.
- **Pending, not yet law:** Mexico's REPEP fines reform; Canada's Bill C-36; the CRTC's ruling on AI voices; the FCC's 2024 proposal on AI-call disclosure.
- **Laws passed but maybe not in force:** Belize (2021), Grenada (2023) and St Kitts and Nevis (2018). Our sources date from 2025.
- **Costa Rica.** Sources disagree on whether the unsolicited-communications rule is article 44 or 47 of Ley 8642. The rule itself (prior consent for automated or electronic direct sales) is consistent.
- **The French overseas collectivities.** We assume the mainland marketing rules (CPCE L34-5 and the consent rule for sales calls) apply in Saint-Barthélemy and Saint-Pierre-et-Miquelon as they do elsewhere in France. We found the CNIL's confirmation for the data protection law only.
- **Bonaire, Sint Eustatius and Saba; Aruba; Sint Maarten.** We found no anti-spam rule, but couldn't rule one out in their telecom laws.
- **Greenland's 2026 marketing act** may now be passed; check whether it adds an opt-in rule.
- **Research limits.** Firecrawl's paid search and scrape credits ran out early in the research, and then the web-search budget did too. Most pages were read through search excerpts rather than in full, and the remaining US checks used the free US government index. Some summaries for the smaller territories rest on one reputable secondary source each (DLA Piper, UWI's regional data-protection pages, DataGuidance, law firms) rather than the statute itself. Mexico's 91% WhatsApp figure is a press estimate.
