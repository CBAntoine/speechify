// Rules for messaging a business's customers, by country, with sources.
// Product guidance, not legal advice. Checked on 2026-11-22. See docs/compliance.md.
// Pure data: no imports, loadable by Node's type stripping in tests.

export interface RuleSource { label: string; url: string }

export interface Rule {
  /** Plain-English summary, one to four sentences, written for a small-agency owner. */
  text: string;
  sources: RuleSource[];
}

export interface CountryRules {
  /** ISO 3166-1 alpha-2. Puerto Rico and the US Virgin Islands follow "US". */
  country: string;
  /** Commercial email: consent model, required content, unsubscribe timing. */
  email: Rule;
  /** Business texting: consent, registration, opt-outs. */
  sms: Rule;
  /** Outbound calls, including automated and AI voices: consent, do-not-call lists, hours. */
  calls: Rule;
  /** Privacy basics for holding and using customer contact data. */
  privacy: Rule;
  /** Local hours (24h clock) between which automated texts and calls should go out by default. */
  quietHours: { start: number; end: number; why: string };
  /** Words people use locally to stop messages (uppercase), beyond the universal STOP list. */
  optOutWords: string[];
  /** Consent the software should require before texting a contact for marketing. */
  smsConsent: "express_written" | "express" | "implied_ok";
  /** Consent the software should require before marketing email. */
  emailConsent: "opt_out_ok" | "implied_ok" | "express";
}

export const COMPLIANCE_CHECKED_ON = "2026-11-22";

/** Words that must stop messages everywhere (uppercase). */
export const UNIVERSAL_OPT_OUT: string[] = [
  // The FCC's standardized revocation words (47 CFR 64.1200(a)(10)).
  "STOP", "QUIT", "END", "REVOKE", "OPT OUT", "CANCEL", "UNSUBSCRIBE",
  // Carrier and platform practice (Twilio's default keywords and common variants).
  "STOPALL", "STOP ALL", "OPTOUT", "OPT-OUT", "UNSUB",
];

// ---------------------------------------------------------------------------
// Sources, shared by the rules below.
// ---------------------------------------------------------------------------

// United States: email
const ftcCanSpam: RuleSource = { label: "FTC: CAN-SPAM Act compliance guide for business", url: "https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business" };
const cfr316: RuleSource = { label: "16 CFR Part 316 (CAN-SPAM Rule)", url: "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316" };

// United States: texts and calls (federal)
const cfr64_1200: RuleSource = { label: "47 CFR 64.1200 (FCC's TCPA rules)", url: "https://www.ecfr.gov/current/title-47/part-64/section-64.1200" };
const usc227: RuleSource = { label: "47 U.S.C. 227 (Telephone Consumer Protection Act)", url: "https://www.law.cornell.edu/uscode/text/47/227" };
const fccAiVoice: RuleSource = { label: "FCC declaratory ruling FCC 24-17 (Feb 2024): AI-generated voices are \"artificial\"", url: "https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf" };
const fccAiVoiceNews: RuleSource = { label: "FCC: TCPA applies to AI technologies that generate human voices", url: "https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices" };
const imcEleventhCircuit: RuleSource = { label: "Insurance Marketing Coalition v. FCC (11th Cir., 24 Jan 2025): one-to-one consent rule vacated", url: "https://media.ca11.uscourts.gov/opinions/pub/files/202410277.pdf" };
const fccDa25_621: RuleSource = { label: "FCC DA 25-621 (July 2025) as published, 90 FR (29 Aug 2025): rule text conformed to the vacatur", url: "https://www.govinfo.gov/content/pkg/FR-2025-08-29/html/2025-16641.htm" };
const fcc24_24: RuleSource = { label: "FCC 24-24 consent-revocation order (Feb 2024)", url: "https://docs.fcc.gov/public/attachments/FCC-24-24A1.pdf" };
const fcc24_24Effective: RuleSource = { label: "Federal Register, 11 Oct 2024: revocation rules effective 11 Apr 2025", url: "https://www.federalregister.gov/documents/2024/10/11/2024-23605/strengthening-the-ability-of-consumers-to-stop-robocalls" };
const fccDa25_312: RuleSource = { label: "FCC DA 25-312: \"revoke all\" part delayed to 11 Apr 2026", url: "https://docs.fcc.gov/public/attachments/DA-25-312A1.pdf" };
const fccDa26_12: RuleSource = { label: "FCC DA 26-12: \"revoke all\" part delayed to 31 Jan 2027", url: "https://docs.fcc.gov/public/attachments/DA-26-12A1.pdf" };
const fcc26_67: RuleSource = { label: "FCC 26-67, 91 FR 67214 (26 Oct 2026): revised revocation rules, effective 25 Nov 2026", url: "https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls" };
const twilio10dlcBlock: RuleSource = { label: "Twilio changelog: unregistered US 10DLC traffic fully blocked from 1 Sep 2023", url: "https://www.twilio.com/en-us/changelog/-u-s--a2p-10dlc--full-blocking-of-traffic-sent-from-unregistered" };
const twilio10dlcShutdown: RuleSource = { label: "Twilio: shutdown of unregistered 10DLC messaging", url: "https://support.twilio.com/hc/en-us/articles/14910496447771-Shutdown-of-Unregistered-10DLC-Messaging" };
const twilioTollFree: RuleSource = { label: "Twilio changelog: unverified toll-free numbers blocked from 31 Jan 2024 (US and Canada)", url: "https://twilio.com/en-us/changelog/messaging-on-u-s--toll-free-phone-numbers-pending-verification-i" };
const ftcPrivacyGuide: RuleSource = { label: "FTC: Protecting Personal Information, a guide for business", url: "https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business" };

// United States: states
const flFtsa: RuleSource = { label: "Fla. Stat. 501.059 (Florida Telephone Solicitation Act)", url: "https://www.flsenate.gov/Laws/Statutes/2026/501.059" };
const flTelemarketing: RuleSource = { label: "Fla. Stat. ch. 501 (501.616: 8am–8pm, 3 calls per 24 hours)", url: "https://www.flsenate.gov/Laws/Statutes/2026/Chapter501/All" };
const okConsent: RuleSource = { label: "Okla. Stat. tit. 15, 775C.3 (written consent for automated sales calls)", url: "https://law.justia.com/codes/oklahoma/title-15/section-15-775c-3/" };
const okHours: RuleSource = { label: "Okla. Stat. tit. 15, 775C.4 (8am–8pm, 3 calls per 24 hours)", url: "https://law.justia.com/codes/oklahoma/title-15/section-15-775c-4/" };
const mdSpamCalls: RuleSource = { label: "Md. Com. Law 14-4502 (Stop the Spam Calls Act)", url: "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-4502" };
const waSolicitation: RuleSource = { label: "RCW 80.36.390 (Washington: no sales calls before 8am or after 8pm)", url: "https://app.leg.wa.gov/RCW/default.aspx?cite=80.36.390" };
const waTexts: RuleSource = { label: "RCW 19.190.070 (Washington: commercial texts need advance consent)", url: "https://app.leg.wa.gov/RCW/default.aspx?cite=19.190.070" };
const ctTelemarketing: RuleSource = { label: "Conn. Gen. Stat. 42-288a (Connecticut: 9am–8pm)", url: "https://www.cga.ct.gov/Current/pub/chap_743m.htm" };
const txHours: RuleSource = { label: "Tex. Bus. & Com. Code ch. 301 (9am–9pm, Sundays from noon)", url: "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.301.htm" };
const txSb140: RuleSource = { label: "Morgan Lewis: Texas telephone solicitation law now covers texts (SB 140, 1 Sep 2025)", url: "https://www.morganlewis.com/pubs/2025/09/texas-telephone-solicitation-law-now-covers-text-messages" };
const paTra: RuleSource = { label: "Pennsylvania Telemarketer Registration Act, s. 5(a)(1) as amended by Act 47 of 2026", url: "https://www.legis.state.pa.us/WU01/LI/LI/US/HTM/1996/0/0147..HTM" };
const paAct47: RuleSource = { label: "National Law Review: Pennsylvania extends its telemarketing law to texts (Act 47, effective 18 Oct 2026)", url: "https://natlawreview.com/article/pennsylvania-expands-telemarketing-law-cover-text-messages-ringless-voicemails-and" };
const riHours: RuleSource = { label: "R.I. Gen. Laws 5-61-3.6 (Rhode Island hours of operation)", url: "https://webserver.rilegislature.gov/Statutes/TITLE5/5-61/5-61-3.6.htm" };
const riDefinitions: RuleSource = { label: "R.I. Gen. Laws 5-61-2 (weekdays 9am–6pm, Saturdays 10am–5pm)", url: "https://webserver.rilegislature.gov/Statutes/TITLE5/5-61/5-61-2.htm" };
const kyHours: RuleSource = { label: "KRS 367.46955(16) (Kentucky: 10am–9pm only)", url: "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=48885" };
const msSunday: RuleSource = { label: "Mississippi HB 1350 (2024), Miss. Code 77-3-603: no sales calls on Sundays", url: "https://billstatus.ls.state.ms.us/documents/2024/html/HB/1300-1399/HB1350SG.htm" };
const orHb3865: RuleSource = { label: "Oregon HB 3865 (2025, enrolled): sales calls and texts 8am–8pm, max 3 per 24 hours", url: "https://olis.oregonlegislature.gov/liz/2025r1/Downloads/MeasureDocument/HB3865/Enrolled" };
const vaSb1339: RuleSource = { label: "Va. Code 59.1-514 (texts: STOP or UNSUBSCRIBE honored for 10 years; SB 1339, effective 1 Jan 2026)", url: "https://law.lis.virginia.gov/vacode/59.1-514/" };

// United States: reviews and AI
const cfr465: RuleSource = { label: "16 CFR Part 465 (FTC rule on consumer reviews and testimonials)", url: "https://www.ecfr.gov/current/title-16/part-465" };
const cfr465_4: RuleSource = { label: "16 CFR 465.4 (no incentives conditioned on a review's sentiment)", url: "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465/section-465.4" };
const ftcReviewsQa: RuleSource = { label: "FTC: Consumer Reviews and Testimonials Rule Q&A (in effect since 21 Oct 2024)", url: "https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers" };
const cfr255_2: RuleSource = { label: "16 CFR 255.2 (FTC Endorsement Guides: review-gating example)", url: "https://www.ecfr.gov/current/title-16/section-255.2" };
const caBot: RuleSource = { label: "Cal. Bus. & Prof. Code 17941 (bot disclosure, SB 1001)", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17941" };
const utAi: RuleSource = { label: "Utah Code 13-75-103 and 13-75-104 (SB 226, 2025): disclose AI when asked; safe harbor for disclosing at the outset", url: "https://le.utah.gov/Session/2025/bills/static/SB0226.html" };
const meAi: RuleSource = { label: "10 M.R.S. 1500-DD (Maine: AI chatbots in trade)", url: "https://legislature.maine.gov/statutes/10/title10sec1500-DD.html" };

// Canada
const caslAct: RuleSource = { label: "Canada's Anti-Spam Legislation, S.C. 2010, c. 23, ss. 6–11", url: "https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-2.html" };
const crtcImplied: RuleSource = { label: "CRTC: CASL guidance on implied consent", url: "https://crtc.gc.ca/eng/com500/guide.htm" };
const crtcCaslFaq: RuleSource = { label: "CRTC: CASL FAQ (text messages are covered)", url: "https://crtc.gc.ca/eng/com500/faq500.htm" };
const crtc2012_548: RuleSource = { label: "CRTC Information Bulletin 2012-548 (identification and unsubscribe requirements)", url: "https://crtc.gc.ca/eng/archive/2012/2012-548.htm" };
const crtcKeyRules: RuleSource = { label: "CRTC: Key Unsolicited Telecommunications Rules (calling hours)", url: "https://crtc.gc.ca/eng/phone/telemarketing/tobligations/rules-regles.htm" };
const crtcUtr: RuleSource = { label: "CRTC Unsolicited Telecommunications Rules (DNCL, telemarketing, ADAD)", url: "https://crtc.gc.ca/eng/trules-reglest.htm" };
const dnclExemptions: RuleSource = { label: "National DNCL: exemptions (18 months after a purchase, 6 months after an inquiry)", url: "https://lnnte-dncl.gc.ca/en/Organization/Exemptions" };
const crtcRegister: RuleSource = { label: "CRTC: telemarketers must register with the National DNCL", url: "https://crtc.gc.ca/eng/phone/telemarketing/tobligations/register-inscrire.htm" };
const crtc2026_132: RuleSource = { label: "CRTC 2026-132 (June 2026): review of the telemarketing rules, including AI voices", url: "https://crtc.gc.ca/eng/archive/2026/2026-132.htm" };
const opcPipeda: RuleSource = { label: "Office of the Privacy Commissioner: PIPEDA in brief", url: "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/" };
const quebecP39: RuleSource = { label: "Quebec: Act respecting the protection of personal information in the private sector (as amended by Law 25)", url: "https://www.legisquebec.gouv.qc.ca/en/document/cs/p-39.1" };
const cfibLaw25: RuleSource = { label: "CFIB: Quebec's Law 25 for small businesses", url: "https://www.cfib-fcei.ca/en/site/qc-law-25" };
const billC36: RuleSource = { label: "DLA Piper: Canada tables Bill C-36 (June 2026)", url: "https://www.dlapiper.com/en/insights/publications/2026/06/canada-tables-bill-c36-the-protecting-privacy-and-consumer-data-act" };
const compBureauEmployees: RuleSource = { label: "Competition Bureau: online reviews posted by employees (Jan 2024)", url: "https://www.canada.ca/en/competition-bureau/news/2024/01/online-reviews-posted-by-employees-businesses-could-be-liable.html" };

// Mexico
const lfpdppp: RuleSource = { label: "Ley Federal de Protección de Datos Personales en Posesión de los Particulares (2025), Cámara de Diputados", url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf" };
const garriguesLfpdppp: RuleSource = { label: "Garrigues: Mexico's new LFPDPPP in force 21 Mar 2025", url: "https://www.garrigues.com/es_ES/noticia/mexico-nueva-ley-federal-proteccion-datos-personales-posesion-particulares-introduce" };
const eyLfpdppp: RuleSource = { label: "EY: INAI's data-protection role moves to the Secretaría Anticorrupción y Buen Gobierno", url: "https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares" };
const lfpc: RuleSource = { label: "Ley Federal de Protección al Consumidor (Cámara de Diputados)", url: "https://www.diputados.gob.mx/LeyesBiblio/ref/lfpc.htm" };
const lfpc17: RuleSource = { label: "LFPC art. 17 (ads must show the business's name, address and phone)", url: "https://mley.mx/LFPC/articulo/17/" };
const lfpc18bis: RuleSource = { label: "LFPC art. 18 Bis (no ads to people who refused or are on the registry)", url: "https://mley.mx/LFPC/articulo/18-bis/" };
const repep: RuleSource = { label: "PROFECO: REPEP (registry to avoid advertising)", url: "https://repep.profeco.gob.mx/" };
const mxSenate2026: RuleSource = { label: "Infobae: Senate approves higher fines for unauthorized sales calls and messages (Oct 2026)", url: "https://www.infobae.com/mexico/2026/10/07/senado-aprueba-reforma-para-sancionar-llamadas-comerciales-sin-consentimiento-multas-superarian-23-millones-de-pesos/" };
const twilioMxSms: RuleSource = { label: "Twilio: Mexico SMS guidelines", url: "https://www.twilio.com/en-us/guidelines/mx/sms" };
const twilioMxRegulatory: RuleSource = { label: "Twilio: Mexico regulatory guidelines (mobile numbers are person-to-person only)", url: "https://www.twilio.com/en-us/guidelines/mx/regulatory" };
const inegiEndutih: RuleSource = { label: "INEGI: ENDUTIH 2024 results", url: "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/endutih/ENDUTIH_24_RR.pdf" };
const mxWhatsappShare: RuleSource = { label: "El Universal: how big WhatsApp is in Mexico (about 91% of internet users)", url: "https://www.eluniversal.com.mx/techbit/que-tan-grande-e-importante-es-whatsapp-en-mexico" };

// WhatsApp and Google (everywhere)
const waOptIn: RuleSource = { label: "Meta: Get opt-in for WhatsApp", url: "https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in" };
const waPolicy: RuleSource = { label: "WhatsApp Business Messaging Policy", url: "https://business.whatsapp.com/policy" };
const waPricing: RuleSource = { label: "Meta: Pricing on the WhatsApp Business Platform", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing" };
const waPricingUpdates: RuleSource = { label: "Meta: pricing updates for service and utility messages (1 Oct 2026)", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages" };
const waTemplates: RuleSource = { label: "Meta: WhatsApp template categorization", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization" };
const waUsPause: RuleSource = { label: "WATI: marketing templates to US numbers still paused (Nov 2026)", url: "https://www.wati.io/en/blog/whatsapp-marketing-messages-us-2026/" };
const googleFakeEngagement: RuleSource = { label: "Google Maps user-contributed content policy: prohibited and restricted content", url: "https://support.google.com/contributionpolicy/answer/7400114" };
const googleReviewTips: RuleSource = { label: "Google Business Profile Help: tips to get more reviews", url: "https://support.google.com/business/answer/3474122" };

// France and the French Caribbean
const cnilProspection: RuleSource = { label: "CNIL: prospection commerciale par courriel, SMS et automate d'appel", url: "https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel" };
const cnilClients: RuleSource = { label: "CNIL: communications électroniques aux prospects et clients", url: "https://www.cnil.fr/fr/communication-electronique-quelles-regles" };
const dgccrfConsent: RuleSource = { label: "DGCCRF: démarchage téléphonique, consentement préalable depuis le 11 août 2026", url: "https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/renforcement-des-mesures-pour-lutter-contre-le-demarchage-abusif" };
const prefectureConsent: RuleSource = { label: "Préfecture de Normandie: sans accord préalable, le démarchage téléphonique est interdit depuis le 11 août", url: "https://www.prefectures-regions.gouv.fr/normandie/Actualites/Depuis-le-11-aout-sans-accord-prealable-le-demarchage-telephonique-est-interdit" };
const dgccrfHours: RuleSource = { label: "DGCCRF: jours, horaires et fréquence du démarchage téléphonique", url: "https://www.economie.gouv.fr/dgccrf/faq-pour-les-professionnels-sur-lencadrement-des-jours-horaires-et-frequence-du-demarchage" };
const cnilOutreMer: RuleSource = { label: "CNIL: la loi Informatique et Libertés et le RGPD outre-mer", url: "https://www.cnil.fr/fr/comment-la-loi-informatique-et-libertes-sapplique-t-elle-loutre-mer" };
const gdpr: RuleSource = { label: "GDPR, Regulation (EU) 2016/679", url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj" };
const euAiAct: RuleSource = { label: "Goodwin: EU AI Act transparency duties apply from 2 Aug 2026", url: "https://www.goodwinlaw.com/en/insights/publications/2026/08/alerts-technology-dpc-eu-ai-act-transparency-obligations-now-in-force" };

// Central America
const dlaGuatemala: RuleSource = { label: "DLA Piper: data protection in Guatemala", url: "https://www.dlapiperdataprotection.com/?c=GT&t=law" };
const iappGuatemala: RuleSource = { label: "IAPP: data protection bill advances in Guatemala", url: "https://iapp.org/news/b/data-protection-law-initiative-advances-in-guatemala" };
const belizeAct: RuleSource = { label: "Belize Data Protection Act 2021 (Act No. 45 of 2021)", url: "https://www.nationalassembly.gov.bz/wp-content/uploads/2021/12/Act-No-45-of-2021-Data-Protection-Act.pdf" };
const dgBelize: RuleSource = { label: "DataGuidance: Belize (commissioner not yet established)", url: "https://www.dataguidance.com/jurisdiction/belize" };
const svDecree: RuleSource = { label: "El Salvador: Ley para la Protección de Datos Personales (Decreto 144, 2024)", url: "https://www.refworld.org/sites/default/files/2025-01/14871.pdf" };
const svInForce: RuleSource = { label: "Diario El Mundo: data-protection and cybersecurity laws in force (Nov 2024)", url: "https://diario.elmundo.sv/politica/vigentes-leyes-de-datos-personales-y-ciberseguridad-organizaciones-temen-por-libertad-de-expresion" };
const dgHonduras: RuleSource = { label: "DataGuidance: Honduras (no comprehensive framework)", url: "https://www.dataguidance.com/jurisdiction/honduras" };
const dlaHonduras: RuleSource = { label: "DLA Piper: data protection in Honduras", url: "https://www.dlapiperdataprotection.com/?c=HN&t=law" };
const dlaNicaragua: RuleSource = { label: "DLA Piper: data protection in Nicaragua", url: "https://www.dlapiperdataprotection.com/?c=NI&t=law" };
const niLey787: RuleSource = { label: "Nicaragua: Ley 787 de Protección de Datos Personales (2012)", url: "https://nicaragua.justia.com/nacionales/leyes/ley-de-proteccion-de-datos-personales-mar-29-2012/gdoc" };
const crLey8642: RuleSource = { label: "Costa Rica: Ley General de Telecomunicaciones 8642 (SUTEL)", url: "https://www.sutel.go.cr/sites/default/files/normativas/ley_general_de_telecomunicaciones.pdf" };
const crSalesCalls: RuleSource = { label: "Tico Times: phone customers can block sales calls (art. 44, Ley 8642)", url: "https://ticotimes.net/2013/01/28/phone-customers-can-now-block-annoying-sales-calls" };
const crLey8968: RuleSource = { label: "Costa Rica: Ley 8968 de Protección de la Persona frente al tratamiento de sus datos personales", url: "https://www.archivonacional.go.cr/web/normativa/ley8968.docx" };
const lexMundiCostaRica: RuleSource = { label: "Lex Mundi: Global Data Privacy Guide, Costa Rica", url: "https://www.lexmundi.com/guides/global-data-privacy-guide/jurisdictions/latin-america-caribbean/costa-rica" };
const dlaPanama: RuleSource = { label: "DLA Piper: data protection in Panama (Ley 81 de 2019, Decreto Ejecutivo 285 de 2021)", url: "https://www.dlapiperdataprotection.com/?t=law&c=PA" };
const antaiGuide: RuleSource = { label: "ANTAI: guía para el sector privado", url: "https://www.antai.gob.pa/wp-content/uploads/2024/01/GUIA-SECTOR-PRIVADO-1.pdf" };

// Caribbean
const dgCuba: RuleSource = { label: "DataGuidance: Cuba (Ley 149, regulator MINJUS)", url: "https://www.dataguidance.com/jurisdiction/cuba" };
const cubaLey149: RuleSource = { label: "MINCOM: Ley 149 de Protección de Datos Personales published (Aug 2022)", url: "https://www.mincom.gob.cu/es/print/5823" };
const jamaicaAct: RuleSource = { label: "Jamaica: The Data Protection Act, 2020", url: "https://japarliament.gov.jm/attachments/article/339/The%20Data%20Protection%20Act,%202020.pdf" };
const chambersJamaica: RuleSource = { label: "Chambers: Data Protection & Privacy 2026, Jamaica", url: "https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/jamaica" };
const dlaHaiti: RuleSource = { label: "DLA Piper: data protection in Haiti", url: "https://www.dlapiperdataprotection.com/?c=HT&t=law" };
const doLey310: RuleSource = { label: "República Dominicana: Ley 310-14 sobre correos electrónicos comerciales no solicitados", url: "https://wp.ogtic.gob.do/wp-content/uploads/2019/02/Ley-310-14.pdf" };
const dlaDominican: RuleSource = { label: "DLA Piper: data protection in the Dominican Republic", url: "https://www.dlapiperdataprotection.com/?c=DO&t=law" };
const doLey172: RuleSource = { label: "Ley 172-13 sobre protección de datos personales (text)", url: "https://phlaw.com/ley-172-13-sobre-proteccion-de-datos-personales/" };
const dlaBahamas: RuleSource = { label: "DLA Piper: data protection in the Bahamas", url: "https://www.dlapiperdataprotection.com/?c=BS&t=law" };
const dlaBarbados: RuleSource = { label: "DLA Piper: data protection in Barbados", url: "https://www.dlapiperdataprotection.com/?c=BB&t=law" };
const barbadosToday: RuleSource = { label: "Barbados Today: your rights under the Data Protection Act 2019 (Jul 2024)", url: "https://barbadostoday.bb/2024/07/16/uncovering-your-rights-what-customers-employees-should-know-about-the-data-protection-act-2019" };
const dlaTrinidad: RuleSource = { label: "DLA Piper: data protection in Trinidad and Tobago", url: "https://www.dlapiperdataprotection.com/?c=TT&t=law" };
const uwiTrinidad: RuleSource = { label: "UWI: data protection laws, Trinidad and Tobago (as at Feb 2025)", url: "https://uwi.edu/data-protection/pg-external_tt.php" };
const uwiAntigua: RuleSource = { label: "UWI: data protection laws, Antigua and Barbuda", url: "https://uwi.edu/data-protection/pg-external_antiguabarbuda.php" };
const uwiDominica: RuleSource = { label: "UWI: data protection laws, Dominica (as at Feb 2025)", url: "https://www.uwi.edu/data-protection/?q=resources-external-dominica" };
const uwiGrenada: RuleSource = { label: "UWI: data protection laws, Grenada", url: "https://uwi.edu/data-protection/pg-external_grenada.php" };
const dgGrenada: RuleSource = { label: "DataGuidance: Grenada", url: "https://www.dataguidance.com/jurisdiction/grenada" };
const uwiStKitts: RuleSource = { label: "UWI: data protection laws, St Kitts and Nevis (as at Feb 2025)", url: "https://www.uwi.edu/data-protection/?q=resources-external-skn" };
const uwiStLucia: RuleSource = { label: "UWI: data protection laws, St Lucia (partly in force since Jan 2023)", url: "https://www.uwi.edu/data-protection/?q=resources-external-slu" };
const uwiStVincent: RuleSource = { label: "UWI: data protection laws, St Vincent and the Grenadines (as at Feb 2025)", url: "https://uwi.edu/data-protection/pg-external_svg.php" };
const caymanAct: RuleSource = { label: "Cayman Islands: Data Protection Act (2021 Revision)", url: "https://www.ombudsman.ky/images/pdf/laws_regs/Data_Protection_Act_2021_Rev.pdf" };
const caymanStopMarketing: RuleSource = { label: "Cayman Ombudsman: the right to stop direct marketing", url: "https://ombudsman.ky/images/pdf/guide/91-the-right-to-stop-direct-marketing.pdf" };
const conyersBermuda: RuleSource = { label: "Conyers: direct marketing in Bermuda in 2026", url: "https://www.conyers.com/publications/view/direct-marketing-in-bermuda-what-businesses-need-to-know-in-2026/" };
const privcomBermuda: RuleSource = { label: "Bermuda Privacy Commissioner: full PIPA implementation date (1 Jan 2025)", url: "https://www.privacy.bm/post/official-date-of-full-pipa-implementation-announced" };
const uwiTurksCaicos: RuleSource = { label: "UWI: data protection laws, Turks and Caicos Islands (as at Feb 2025)", url: "https://uwi.edu/data-protection/pg-external_tci.php" };
const bviAct: RuleSource = { label: "BVI: Data Protection Act, 2021 (No. 3 of 2021)", url: "https://laws.gov.vg/sites/default/files/2021-12/No.%203%20of%202021-Data%20Protection%20Act,%202021.pdf" };
const applebyBvi: RuleSource = { label: "Appleby: data protection guide, British Virgin Islands", url: "https://applebyglobal.com/publications/data-protection-guide-british-virgin-islands" };
const uwiAnguilla: RuleSource = { label: "UWI: data protection laws, Anguilla (as at Feb 2025)", url: "https://uwi.edu/data-protection/pg-external_anguilla.php" };
const uwiMontserrat: RuleSource = { label: "UWI: data protection laws, Montserrat (as at Feb 2025)", url: "https://uwi.edu/data-protection/pg-external_montserrat.php" };
const dlaAruba: RuleSource = { label: "DLA Piper: data protection in Aruba", url: "https://www.dlapiperdataprotection.com/?c=AW&t=law" };
const dlaCuracao: RuleSource = { label: "DLA Piper: data protection in Curaçao", url: "https://www.dlapiperdataprotection.com/?c=CW&t=law" };
const curacaoOversight: RuleSource = { label: "Curaçao Chronicle: Dutch privacy authority warns of weak oversight (Jun 2026)", url: "https://www.curacaochronicle.com/post/local/dutch-privacy-authority-warns-curacao-lacks-effective-data-protection-oversight" };
const dlaSintMaarten: RuleSource = { label: "DLA Piper: data protection in Sint Maarten", url: "https://www.dlapiperdataprotection.com/?c=SX&t=law" };
const wbpBes: RuleSource = { label: "Wet bescherming persoonsgegevens BES (Staatsblad 2010, 349)", url: "https://zoek.officielebekendmakingen.nl/stb-2010-349.pdf" };
const dlaBes: RuleSource = { label: "DLA Piper: data protection in Bonaire, Sint Eustatius and Saba", url: "https://www.dlapiperdataprotection.com/?t=law&c=BQ" };

// Greenland
const dgGreenland: RuleSource = { label: "DataGuidance: Greenland (own data protection act since 1 Dec 2016)", url: "https://www.dataguidance.com/jurisdiction/greenland" };
const greenlandMarketingBill: RuleSource = { label: "Inatsisartut: marketing act bill FM2026/26 (comments, in Danish)", url: "https://ina.gl/media/kaybnx3z/pkt26_fm2026_markedsfoeringsloven_bem_da.pdf" };
const danishSpamGuide: RuleSource = { label: "Danish Consumer Ombudsman: guidance on the spam ban (2021)", url: "https://forbrugerombudsmanden.dk/media/bjajzdv1/vejledning-om-spamforbuddet-2021-a.pdf" };

// ---------------------------------------------------------------------------
// Shared wording.
// ---------------------------------------------------------------------------

const SPANISH: string[] = ["ALTO", "BAJA", "CANCELAR", "PARAR", "DETENER", "DESUSCRIBIR", "NO MAS", "NO MÁS"];
const FRENCH: string[] = ["ARRET", "ARRÊT", "DESABONNER", "DÉSABONNER", "DESINSCRIRE", "DÉSINSCRIRE", "ANNULER"];
const DUTCH: string[] = ["STOPPEN", "AFMELDEN", "UITSCHRIJVEN"];
/** Papiamento "para" (stop) for Aruba, Curaçao and Bonaire, where Spanish is also common. */
const DUTCH_CARIBBEAN: string[] = [...DUTCH, "PARA", ...SPANISH];

const COURTEOUS_HOURS = { start: 9, end: 20, why: "No legal calling hours found for marketing; 9:00–20:00 local time on ordinary days (not public holidays) is a courteous default." };
const FRENCH_HOURS = { start: 10, end: 20, why: "French rules allow sales calls only Monday–Friday 10:00–13:00 and 14:00–20:00, never on weekends or public holidays, and at most 4 times in 30 days; skip 13:00–14:00 and weekends too." };

const NO_LAW_EMAIL = "No anti-spam law was found, so use the sensible default: email only customers and people who asked to hear from you, say who you are, and honor unsubscribes at once.";
const NO_LAW_SMS = "No law on marketing texts was found, so get an opt-in first, name your business in every text, and honor STOP and local-language opt-outs. WhatsApp, which many customers here prefer, requires an opt-in anyway.";
const NO_LAW_CALLS = "No telemarketing law or do-not-call registry was found; call only customers or people who asked, between 9:00 and 20:00, say who you are (and that you're an AI if you are), and stop when asked.";

export const RULES: CountryRules[] = [
  // ------------------------------------------------------------------ Canada
  {
    country: "CA",
    email: {
      text: "CASL requires consent before any commercial email: express consent you can prove, or implied consent from an existing business relationship (a purchase in the last 2 years or an inquiry in the last 6 months). Every message must name your business, give a mailing address plus a phone number, email or web address, and include an unsubscribe link that works for at least 60 days. Honor unsubscribes within 10 business days, at no cost to the person.",
      sources: [caslAct, crtcImplied, crtc2012_548],
    },
    sms: {
      text: "Marketing texts are commercial electronic messages, so CASL's consent, identification and unsubscribe rules apply; if the details don't fit, link to a page with them and accept a STOP reply. Implied consent runs out (2 years after the last purchase, 6 months after an inquiry), so ask for express consent whenever you can. Canada has no 10DLC registration, but toll-free numbers must be verified before they can text.",
      sources: [crtcCaslFaq, crtc2012_548, crtcImplied, twilioTollFree],
    },
    calls: {
      text: "Sales calls are allowed only 9:00–21:30 on weekdays and 10:00–18:00 on weekends (the called person's time), and the caller must say who they are and why they're calling. Register with the National Do Not Call List and don't call listed numbers unless an exemption applies, such as a purchase in the last 18 months or an inquiry in the last 6 months; a person's own do-not-call request always wins. Sales calls made with an automatic dialing-announcing device (a recorded or synthetic voice) need the person's express consent first; the CRTC is consulting on whether AI voices count, so treat AI calls that way.",
      sources: [crtcKeyRules, crtcUtr, dnclExemptions, crtcRegister, crtc2026_132],
    },
    privacy: {
      text: "Outside Quebec, PIPEDA (or Alberta's and BC's similar laws) requires meaningful consent, use only for the purposes you stated, safeguards and access on request. Quebec's Law 25 is stricter: consent must be clear and specific, you need a published privacy policy and a named person in charge of privacy (the head of the business by default), and serious data incidents must be reported to the Commission d'accès à l'information. A new federal privacy bill, C-36, was tabled in June 2026 but isn't law yet.",
      sources: [opcPipeda, quebecP39, cfibLaw25, billC36],
    },
    quietHours: { start: 10, end: 18, why: "CRTC sales-call hours are 9:00–21:30 on weekdays and 10:00–18:00 on weekends, in the called person's time; 10:00–18:00 works every day. CASL sets no hours for texts and email, but the same window is courteous." },
    optOutWords: FRENCH,
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },

  // ----------------------------------------------------------- United States
  {
    country: "US",
    email: {
      text: "CAN-SPAM lets you email without prior consent, but every marketing email needs accurate From and subject lines, a clear statement that it's an ad, your valid postal address and an easy way to opt out. Honor opt-outs within 10 business days and keep the opt-out working for at least 30 days after you send. Receipts and appointment details are mostly exempt, but a mixed email counts as marketing if its subject or opening is promotional.",
      sources: [ftcCanSpam, cfr316],
    },
    sms: {
      text: "Marketing texts sent with automated tools need prior express written consent: a signed agreement (a checkbox or e-signature counts) that names your business, covers marketing texts and says consent isn't a condition of purchase; the FCC's one-to-one consent rule was vacated in January 2025, so one form may again name several sellers. Honor STOP, QUIT, END, REVOKE, OPT OUT, CANCEL, UNSUBSCRIBE and any other clear request within 10 business days; one confirmation text within 5 minutes is allowed, and from 25 November 2026 you may make reply-STOP your only opt-out method if every text says so. Texts from US local numbers need A2P 10DLC registration and toll-free numbers need verification, or carriers block them. Florida and Maryland require written consent for automated sales texts, Washington requires advance affirmative consent for commercial texts, and Texas (Sept 2025), Oregon and Virginia (Jan 2026) and Pennsylvania (Oct 2026) now treat marketing texts like sales calls.",
      sources: [cfr64_1200, imcEleventhCircuit, fccDa25_621, fcc24_24, fcc26_67, twilio10dlcBlock, twilioTollFree, flFtsa, okConsent, mdSpamCalls, waTexts, txSb140, orHb3865, vaSb1339, paAct47],
    },
    calls: {
      text: "Calls that use an AI or prerecorded voice need consent (prior express written consent for marketing, prior express consent for informational calls), because the FCC ruled in February 2024 that AI-generated voices are \"artificial\" under the TCPA; such calls must name your business at the start, give a callback number and, for marketing, offer an automated opt-out. Don't make sales calls or texts to numbers on the National Do Not Call Registry (re-check at least every 31 days) or your own do-not-call list; a purchase in the last 18 months or an inquiry in the last 3 months is an exception for live calls only. Federal law allows sales calls 8am–9pm local time, but many states are stricter, so the default window is narrower. Florida, Oklahoma, Maryland and Oregon also cap sales calls at 3 per person per 24 hours.",
      sources: [usc227, cfr64_1200, fccAiVoice, fccAiVoiceNews, flTelemarketing, okHours, mdSpamCalls, orHb3865],
    },
    privacy: {
      text: "There's no general federal privacy law for small businesses, but the FTC treats broken privacy promises and lax security as unfair or deceptive, so say what you collect and why, and protect it. Keep a record of every consent (who, when, how and the exact wording shown) for as long as you message the person and for several years after, because TCPA cases turn on proof of consent and allow $500–$1,500 per message.",
      sources: [ftcPrivacyGuide, usc227, cfr64_1200],
    },
    quietHours: { start: 10, end: 18, why: "10:00–18:00 in the contact's time zone fits every state's sales-call window on weekdays: Kentucky starts at 10am and Rhode Island stops at 6pm (5pm on Saturdays); Pennsylvania (since 18 Oct 2026) stops at 7pm, Connecticut, Florida, Oklahoma, Maryland, Washington and Oregon at 8pm, federal law at 9pm. Pennsylvania, Rhode Island and Mississippi ban sales calls on Sundays and Texas allows them only from noon, so also skip Sundays and holidays." },
    optOutWords: SPANISH,
    smsConsent: "express_written",
    emailConsent: "opt_out_ok",
  },

  // ------------------------------------------------------------------ Mexico
  {
    country: "MX",
    email: {
      text: "You may email marketing to people whose data you collected with a privacy notice (aviso de privacidad) that mentions marketing, as long as they haven't objected. Every ad must show your business's name, address and phone number (or email), and you must stop as soon as someone says they don't want ads (LFPC art. 18 Bis). In October 2026 the Senate approved much higher fines for repeated unauthorized sales contacts; the Chamber of Deputies still has to vote.",
      sources: [lfpdppp, lfpc17, lfpc18bis, mxSenate2026],
    },
    sms: {
      text: "Don't send ads to numbers on PROFECO's REPEP registry or to anyone who has said no, and name your business in every text. Through Twilio, Mexican mobile numbers can't send automated (A2P) texts; use a registered alphanumeric sender ID, a short code or a +1 number. Most Mexicans message businesses on WhatsApp, which needs an opt-in and approved templates.",
      sources: [lfpc18bis, repep, twilioMxSms, twilioMxRegulatory, inegiEndutih, mxWhatsappShare, waOptIn],
    },
    calls: {
      text: "Check REPEP before sales calls, say who you are, and stop calling anyone who asks you to. No calling-hour rule for marketing was found, so the default is a courteous 9:00–20:00. We found no Mexican rule on AI voices, but say you're an AI assistant if asked.",
      sources: [repep, lfpc, lfpc18bis],
    },
    privacy: {
      text: "The new LFPDPPP has applied since 21 March 2025: give a privacy notice when you collect data saying who you are, what you'll use it for and how people can exercise their access, rectification, cancellation and opposition (ARCO) rights. Consent can be tacit for ordinary contact data once the notice is given and the person doesn't object; get express consent for financial or sensitive data. The authority is now the Secretaría Anticorrupción y Buen Gobierno, which took over from the dissolved INAI.",
      sources: [lfpdppp, garriguesLfpdppp, eyLfpdppp],
    },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },

  // --------------------------------------------------------- Central America
  {
    country: "GT",
    email: { text: `Guatemala: ${NO_LAW_EMAIL}`, sources: [dlaGuatemala] },
    sms: { text: `Guatemala: ${NO_LAW_SMS}`, sources: [dlaGuatemala, waOptIn] },
    calls: { text: `Guatemala: ${NO_LAW_CALLS}`, sources: [dlaGuatemala] },
    privacy: { text: "Guatemala has no general data protection law yet (bills are in Congress); people can enforce habeas data through the courts. Keep contact data secure and use it only for the purpose you gave.", sources: [dlaGuatemala, iappGuatemala] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "BZ",
    email: { text: `Belize: ${NO_LAW_EMAIL}`, sources: [belizeAct, dgBelize] },
    sms: { text: `Belize: ${NO_LAW_SMS}`, sources: [belizeAct, waOptIn] },
    calls: { text: `Belize: ${NO_LAW_CALLS}`, sources: [belizeAct] },
    privacy: { text: "Belize passed a Data Protection Act in 2021, but it starts only on a date the Minister sets by order and no Data Protection Commissioner had been reported, so follow its principles (consent, stated purposes, security) without relying on it being enforced.", sources: [belizeAct, dgBelize] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "SV",
    email: { text: "No anti-spam law was found in El Salvador, but its Personal Data Protection Law (in force since November 2024) governs using people's data, so get consent before marketing email, say who you are and honor unsubscribes at once.", sources: [svDecree, svInForce] },
    sms: { text: "Get an opt-in before marketing texts or WhatsApp messages, name your business and honor STOP and BAJA.", sources: [svDecree, waOptIn] },
    calls: { text: "No telemarketing rules or do-not-call registry; call only customers or people who asked, between 9:00 and 20:00, say who you are, and stop when asked.", sources: [svDecree] },
    privacy: { text: "The Personal Data Protection Law (Decree 144) has applied since November 2024 to all businesses handling personal data, under the State Cybersecurity Agency (ACE); people can ask you to delete their data.", sources: [svDecree, svInForce] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "HN",
    email: { text: `Honduras: ${NO_LAW_EMAIL}`, sources: [dgHonduras] },
    sms: { text: `Honduras: ${NO_LAW_SMS}`, sources: [dgHonduras, waOptIn] },
    calls: { text: `Honduras: ${NO_LAW_CALLS}`, sources: [dgHonduras] },
    privacy: { text: "Honduras has no comprehensive data protection law (a draft hasn't been enacted); keep data secure and use it only as you said you would.", sources: [dgHonduras, dlaHonduras] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "NI",
    email: { text: "No anti-spam law was found in Nicaragua, but Law 787 requires consent to use personal data, so get consent before marketing email, say who you are and honor unsubscribes.", sources: [niLey787, dlaNicaragua] },
    sms: { text: "Get an opt-in before marketing texts or WhatsApp messages, name your business and honor STOP and BAJA.", sources: [niLey787, waOptIn] },
    calls: { text: "No telemarketing rules or do-not-call registry; call only customers or people who asked, between 9:00 and 20:00, say who you are, and stop when asked.", sources: [niLey787] },
    privacy: { text: "Law 787 on Personal Data Protection (2012) requires consent and lets people access, correct and delete their data; its supervisory office was never fully set up, so enforcement is weak.", sources: [niLey787, dlaNicaragua] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "CR",
    email: { text: "Costa Rica's telecom law (Ley 8642) bans using email, automated calls, fax or similar tools for direct sales without the person's prior consent, and SUTEL enforces it; name your business and honor unsubscribes.", sources: [crLey8642, crSalesCalls] },
    sms: { text: "The same prior-consent rule covers marketing texts; get an opt-in and honor STOP and BAJA.", sources: [crLey8642, crSalesCalls] },
    calls: { text: "Automated (including AI-voice) sales calls need prior consent under Ley 8642, and people can block sales calls through their operator; make live calls only to customers or people who asked, 9:00–20:00.", sources: [crLey8642, crSalesCalls] },
    privacy: { text: "Ley 8968 (2011) requires informed consent to collect and use personal data, with rights of access, correction and deletion, supervised by PRODHAB.", sources: [crLey8968, lexMundiCostaRica] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "PA",
    email: { text: "No anti-spam law was found in Panama, but Law 81 of 2019 requires prior, informed consent to process personal data, so get consent before marketing email, say who you are and honor unsubscribes.", sources: [dlaPanama, antaiGuide] },
    sms: { text: "Get an opt-in before marketing texts or WhatsApp messages, name your business and honor STOP and BAJA.", sources: [dlaPanama, waOptIn] },
    calls: { text: "No do-not-call registry; call only customers or people who asked, between 9:00 and 20:00, say who you are, and stop when asked.", sources: [dlaPanama] },
    privacy: { text: "Law 81 of 2019 (in force since March 2021) and Executive Decree 285 of 2021 require consent, stated purposes and security, and give people access, correction, deletion and objection rights, supervised by ANTAI.", sources: [dlaPanama, antaiGuide] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "express",
  },

  // --------------------------------------------------------------- Caribbean
  {
    country: "CU",
    email: { text: "No anti-spam law was found in Cuba, but Law 149 (in force since 2023) requires consent to use personal data, so get consent before marketing email and honor unsubscribes.", sources: [dgCuba, cubaLey149] },
    sms: { text: "Get an opt-in before marketing texts or WhatsApp messages, name your business and honor STOP and BAJA.", sources: [dgCuba, waOptIn] },
    calls: { text: "No telemarketing rules; call only customers or people who asked, between 9:00 and 20:00, say who you are, and stop when asked.", sources: [dgCuba] },
    privacy: { text: "Law 149 on Personal Data Protection (published August 2022) requires consent and limits use to stated purposes; the Ministry of Justice supervises it.", sources: [dgCuba, cubaLey149] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "JM",
    email: { text: "Under the Data Protection Act 2020 you may market only to people who consented or are already your customers, and anyone can tell you to stop; name your business and honor unsubscribes at once.", sources: [jamaicaAct, chambersJamaica] },
    sms: { text: "The same direct-marketing rule covers texts: customers or people who consented, with STOP honored at once.", sources: [jamaicaAct, chambersJamaica] },
    calls: { text: "Marketing calls follow the same consent-or-customer rule; there's no do-not-call registry, so call 9:00–20:00, say who you are and stop when asked.", sources: [jamaicaAct, chambersJamaica] },
    privacy: { text: "The Data Protection Act 2020 has fully applied since December 2023; follow its data protection standards and register with the Information Commissioner if required.", sources: [jamaicaAct, chambersJamaica] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },
  {
    country: "HT",
    email: { text: `Haiti: ${NO_LAW_EMAIL}`, sources: [dlaHaiti] },
    sms: { text: `Haiti: ${NO_LAW_SMS}`, sources: [dlaHaiti, waOptIn] },
    calls: { text: `Haiti: ${NO_LAW_CALLS}`, sources: [dlaHaiti] },
    privacy: { text: "Haiti has no comprehensive data protection law; the Penal Code punishes processing personal data in breach of legal formalities, so collect only what you need and keep it secure.", sources: [dlaHaiti] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [...FRENCH, "SISPANN"],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "DO",
    email: { text: "Law 310-14 regulates unsolicited commercial email and requires the recipient's consent unless an exception applies; also name your business and honor unsubscribes at once.", sources: [doLey310, dlaDominican] },
    sms: { text: "No specific texting law, but Law 172-13 requires consent to use personal data; get an opt-in and honor STOP and BAJA.", sources: [doLey172, dlaDominican] },
    calls: { text: "No do-not-call registry; call only customers or people who asked, between 9:00 and 20:00, say who you are, and stop when asked.", sources: [dlaDominican] },
    privacy: { text: "Law 172-13 (2013) requires consent and gives people access, correction, objection and deletion rights over their data.", sources: [doLey172, dlaDominican] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: SPANISH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "BS",
    email: { text: "No anti-spam law was found in the Bahamas; under the Data Protection Act 2003 people can forbid you from using their data for direct marketing (which covers email), so honor unsubscribes at once.", sources: [dlaBahamas] },
    sms: { text: "The same right to stop direct marketing covers texts; text customers or people who opted in and honor STOP at once.", sources: [dlaBahamas] },
    calls: { text: "No telemarketing rules or do-not-call registry; call 9:00–20:00, say who you are, and stop when asked.", sources: [dlaBahamas] },
    privacy: { text: "The Data Protection (Privacy of Personal Information) Act 2003 requires fair collection, stated purposes and security, and lets people see their data.", sources: [dlaBahamas] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },
  {
    country: "BB",
    email: { text: "No anti-spam law was found in Barbados; under the Data Protection Act 2019 people can object to direct marketing and you must then stop, so include an unsubscribe and honor it at once.", sources: [dlaBarbados, barbadosToday] },
    sms: { text: "The right to object to direct marketing covers texts; text customers or people who opted in and honor STOP at once.", sources: [dlaBarbados, barbadosToday] },
    calls: { text: "No telemarketing rules or do-not-call registry; call 9:00–20:00, say who you are, and stop when asked.", sources: [dlaBarbados] },
    privacy: { text: "The Data Protection Act 2019 (in force since 2021, with some parts still awaiting proclamation) sets GDPR-style principles and rights.", sources: [dlaBarbados] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },
  {
    country: "TT",
    email: { text: `Trinidad and Tobago: ${NO_LAW_EMAIL}`, sources: [dlaTrinidad, uwiTrinidad] },
    sms: { text: `Trinidad and Tobago: ${NO_LAW_SMS}`, sources: [uwiTrinidad, waOptIn] },
    calls: { text: `Trinidad and Tobago: ${NO_LAW_CALLS}`, sources: [uwiTrinidad] },
    privacy: { text: "The Data Protection Act 2011 is only partly in force (its general privacy principles, not its enforcement parts), so follow those principles: consent, stated purposes and security.", sources: [dlaTrinidad, uwiTrinidad] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "AG",
    email: { text: "No anti-spam law was found in Antigua and Barbuda, but its Data Protection Act 2013 builds on consent to use personal data, so get consent before marketing email and honor unsubscribes.", sources: [uwiAntigua] },
    sms: { text: "Get an opt-in before marketing texts or WhatsApp messages, name your business and honor STOP.", sources: [uwiAntigua, waOptIn] },
    calls: { text: "No telemarketing rules or do-not-call registry; call only customers or people who asked, 9:00–20:00, say who you are, and stop when asked.", sources: [uwiAntigua] },
    privacy: { text: "The Data Protection Act 2013 (No. 10 of 2013) is enforced by the Information Commissioner; it's unclear how actively.", sources: [uwiAntigua] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "DM",
    email: { text: `Dominica: ${NO_LAW_EMAIL}`, sources: [uwiDominica] },
    sms: { text: `Dominica: ${NO_LAW_SMS}`, sources: [uwiDominica, waOptIn] },
    calls: { text: `Dominica: ${NO_LAW_CALLS}`, sources: [uwiDominica] },
    privacy: { text: "Dominica had no comprehensive data protection law as of February 2025 (an OECS-wide model law is in development); keep data secure and use it only as you said.", sources: [uwiDominica] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "GD",
    email: { text: `Grenada: ${NO_LAW_EMAIL}`, sources: [uwiGrenada] },
    sms: { text: `Grenada: ${NO_LAW_SMS}`, sources: [uwiGrenada, waOptIn] },
    calls: { text: `Grenada: ${NO_LAW_CALLS}`, sources: [uwiGrenada] },
    privacy: { text: "The Data Protection Act No. 1 of 2023 was enacted in May 2023 with an Information Commission, but no commencement date was found, so follow its principles without relying on enforcement.", sources: [uwiGrenada, dgGrenada] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "KN",
    email: { text: `St Kitts and Nevis: ${NO_LAW_EMAIL}`, sources: [uwiStKitts] },
    sms: { text: `St Kitts and Nevis: ${NO_LAW_SMS}`, sources: [uwiStKitts, waOptIn] },
    calls: { text: `St Kitts and Nevis: ${NO_LAW_CALLS}`, sources: [uwiStKitts] },
    privacy: { text: "The Data Protection Act 2018 was passed but hadn't been brought into force as of February 2025; follow its principles anyway.", sources: [uwiStKitts] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "LC",
    email: { text: `St Lucia: ${NO_LAW_EMAIL}`, sources: [uwiStLucia] },
    sms: { text: `St Lucia: ${NO_LAW_SMS}`, sources: [uwiStLucia, waOptIn] },
    calls: { text: `St Lucia: ${NO_LAW_CALLS}`, sources: [uwiStLucia] },
    privacy: { text: "The Data Protection Act (Cap 8.18) has been partly in force since January 2023; the rights to access, correct and object and the enforcement powers are still pending, and no commissioner's office has been set up.", sources: [uwiStLucia] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "VC",
    email: { text: `St Vincent and the Grenadines: ${NO_LAW_EMAIL}`, sources: [uwiStVincent] },
    sms: { text: `St Vincent and the Grenadines: ${NO_LAW_SMS}`, sources: [uwiStVincent, waOptIn] },
    calls: { text: `St Vincent and the Grenadines: ${NO_LAW_CALLS}`, sources: [uwiStVincent] },
    privacy: { text: "There's no private-sector data protection law; the Privacy Act 2003 covers only public authorities and isn't in force.", sources: [uwiStVincent] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "KY",
    email: { text: "No anti-spam law was found in the Cayman Islands, but under the Data Protection Act anyone can tell you to stop using their data for direct marketing and you can't refuse; include an unsubscribe and honor it at once.", sources: [caymanStopMarketing, caymanAct] },
    sms: { text: "The same right to stop direct marketing covers texts; text customers or people who opted in and honor STOP at once.", sources: [caymanStopMarketing] },
    calls: { text: "No do-not-call registry; call 9:00–20:00, say who you are, and stop when asked.", sources: [caymanStopMarketing] },
    privacy: { text: "The Data Protection Act (2021 Revision), in force since 2019, sets GDPR-style principles and rights, enforced by the Ombudsman.", sources: [caymanAct, caymanStopMarketing] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },
  {
    country: "BM",
    email: { text: "No anti-spam law was found in Bermuda; under PIPA people can ask you to stop, or not start, using their information for marketing (section 19), so include an unsubscribe and honor it at once.", sources: [conyersBermuda] },
    sms: { text: "The same right covers texts; text customers or people who opted in and honor STOP at once.", sources: [conyersBermuda] },
    calls: { text: "No do-not-call registry; call 9:00–20:00, say who you are, and stop when asked.", sources: [conyersBermuda] },
    privacy: { text: "The Personal Information Protection Act 2016 has fully applied since 1 January 2025, enforced by the Privacy Commissioner.", sources: [privcomBermuda, conyersBermuda] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },
  {
    country: "TC",
    email: { text: `Turks and Caicos: ${NO_LAW_EMAIL}`, sources: [uwiTurksCaicos] },
    sms: { text: `Turks and Caicos: ${NO_LAW_SMS}`, sources: [uwiTurksCaicos, waOptIn] },
    calls: { text: `Turks and Caicos: ${NO_LAW_CALLS}`, sources: [uwiTurksCaicos] },
    privacy: { text: "There's no comprehensive data protection law (the Electronic Transactions Ordinance allows rules that haven't been made); keep data secure and use it only as you said.", sources: [uwiTurksCaicos] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "VG",
    email: { text: "No anti-spam law was found in the British Virgin Islands; under the Data Protection Act 2021 people can require you in writing to stop, or not begin, direct marketing, so include an unsubscribe and honor it at once.", sources: [bviAct, applebyBvi] },
    sms: { text: "The same right covers texts; text customers or people who opted in and honor STOP at once.", sources: [bviAct, applebyBvi] },
    calls: { text: "No do-not-call registry; call 9:00–20:00, say who you are, and stop when asked.", sources: [bviAct] },
    privacy: { text: "The Data Protection Act 2021 has applied since 9 July 2021 to businesses handling personal data, and provides for an Information Commissioner to enforce it.", sources: [bviAct, applebyBvi] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "implied_ok",
    emailConsent: "implied_ok",
  },
  {
    country: "AI",
    email: { text: `Anguilla: ${NO_LAW_EMAIL}`, sources: [uwiAnguilla] },
    sms: { text: `Anguilla: ${NO_LAW_SMS}`, sources: [uwiAnguilla, waOptIn] },
    calls: { text: `Anguilla: ${NO_LAW_CALLS}`, sources: [uwiAnguilla] },
    privacy: { text: "Anguilla had no comprehensive data protection law as of February 2025; keep data secure and use it only as you said.", sources: [uwiAnguilla] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "MS",
    email: { text: `Montserrat: ${NO_LAW_EMAIL}`, sources: [uwiMontserrat] },
    sms: { text: `Montserrat: ${NO_LAW_SMS}`, sources: [uwiMontserrat, waOptIn] },
    calls: { text: `Montserrat: ${NO_LAW_CALLS}`, sources: [uwiMontserrat] },
    privacy: { text: "Montserrat had no comprehensive data protection law as of February 2025; keep data secure and use it only as you said.", sources: [uwiMontserrat] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: [],
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "AW",
    email: { text: `Aruba: ${NO_LAW_EMAIL}`, sources: [dlaAruba] },
    sms: { text: `Aruba: ${NO_LAW_SMS}`, sources: [dlaAruba, waOptIn] },
    calls: { text: `Aruba: ${NO_LAW_CALLS}`, sources: [dlaAruba] },
    privacy: { text: "Aruba's data law is the older Landsverordening persoonsregistraties, modeled on a former Dutch act; it sets basic rules for registering and using personal data.", sources: [dlaAruba] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: DUTCH_CARIBBEAN,
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "CW",
    email: { text: `Curaçao: ${NO_LAW_EMAIL}`, sources: [dlaCuracao] },
    sms: { text: `Curaçao: ${NO_LAW_SMS}`, sources: [dlaCuracao, waOptIn] },
    calls: { text: `Curaçao: ${NO_LAW_CALLS}`, sources: [dlaCuracao] },
    privacy: { text: "The Landsverordening bescherming persoonsgegevens (2010) sets general data protection rules but has no electronic-marketing rules; in June 2026 the Dutch privacy authority warned that oversight is weak.", sources: [dlaCuracao, curacaoOversight] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: DUTCH_CARIBBEAN,
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "SX",
    email: { text: `Sint Maarten: ${NO_LAW_EMAIL}`, sources: [dlaSintMaarten] },
    sms: { text: `Sint Maarten: ${NO_LAW_SMS}`, sources: [dlaSintMaarten, waOptIn] },
    calls: { text: `Sint Maarten: ${NO_LAW_CALLS}`, sources: [dlaSintMaarten] },
    privacy: { text: "The Landsverordening bescherming persoonsgegevens (2010) sets general data protection rules, with a Personal Data Protection Committee.", sources: [dlaSintMaarten] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: DUTCH,
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "BQ",
    email: { text: `Bonaire, Sint Eustatius and Saba: ${NO_LAW_EMAIL}`, sources: [dlaBes] },
    sms: { text: `Bonaire, Sint Eustatius and Saba: ${NO_LAW_SMS}`, sources: [dlaBes, waOptIn] },
    calls: { text: `Bonaire, Sint Eustatius and Saba: ${NO_LAW_CALLS}`, sources: [dlaBes] },
    privacy: { text: "The islands use the Wet bescherming persoonsgegevens BES (2010) instead of the GDPR, supervised by the CBP BES, which has few enforcement powers.", sources: [wbpBes, dlaBes] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: DUTCH_CARIBBEAN,
    smsConsent: "express",
    emailConsent: "implied_ok",
  },
  {
    country: "GP",
    email: { text: "French law (CPCE art. L34-5) requires prior opt-in consent for marketing email to individuals; the only exception is existing customers, for similar products, if they could refuse when you collected the address and can in every message. Each email must name the sender and offer a free, easy opt-out.", sources: [cnilProspection, cnilClients] },
    sms: { text: "The same opt-in rule covers marketing texts; existing customers may get texts about similar products only if they could refuse at collection and in every text.", sources: [cnilProspection, cnilClients] },
    calls: { text: "Since 11 August 2026 sales calls to consumers need their prior consent (the Bloctel opt-out list has ended), and automated or AI-voice sales calls need consent too. Calls are allowed only Monday–Friday 10:00–13:00 and 14:00–20:00, never on weekends or public holidays, and at most 4 times in 30 days.", sources: [dgccrfConsent, prefectureConsent, dgccrfHours, cnilProspection] },
    privacy: { text: "Guadeloupe is part of the EU, so the GDPR applies in full: have a lawful basis, give a privacy notice, honor access and deletion requests, and report serious breaches to the CNIL within 72 hours.", sources: [gdpr, cnilOutreMer] },
    quietHours: FRENCH_HOURS,
    optOutWords: FRENCH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "MQ",
    email: { text: "French law (CPCE art. L34-5) requires prior opt-in consent for marketing email to individuals; the only exception is existing customers, for similar products, if they could refuse when you collected the address and can in every message. Each email must name the sender and offer a free, easy opt-out.", sources: [cnilProspection, cnilClients] },
    sms: { text: "The same opt-in rule covers marketing texts; existing customers may get texts about similar products only if they could refuse at collection and in every text.", sources: [cnilProspection, cnilClients] },
    calls: { text: "Since 11 August 2026 sales calls to consumers need their prior consent (the Bloctel opt-out list has ended), and automated or AI-voice sales calls need consent too. Calls are allowed only Monday–Friday 10:00–13:00 and 14:00–20:00, never on weekends or public holidays, and at most 4 times in 30 days.", sources: [dgccrfConsent, prefectureConsent, dgccrfHours, cnilProspection] },
    privacy: { text: "Martinique is part of the EU, so the GDPR applies in full: have a lawful basis, give a privacy notice, honor access and deletion requests, and report serious breaches to the CNIL within 72 hours.", sources: [gdpr, cnilOutreMer] },
    quietHours: FRENCH_HOURS,
    optOutWords: FRENCH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "BL",
    email: { text: "Saint-Barthélemy follows French marketing law: prior opt-in consent for marketing email to individuals (CPCE art. L34-5), except existing customers for similar products who could refuse; name the sender and offer a free opt-out.", sources: [cnilProspection, cnilOutreMer] },
    sms: { text: "The same opt-in rule covers marketing texts; honor STOP and ARRÊT.", sources: [cnilProspection] },
    calls: { text: "French rules apply: sales calls to consumers need prior consent since 11 August 2026, only Monday–Friday 10:00–13:00 and 14:00–20:00, at most 4 times in 30 days.", sources: [dgccrfConsent, dgccrfHours] },
    privacy: { text: "Saint-Barthélemy isn't part of the EU, but France's data protection law applies there and gives effect to GDPR-equivalent rules, with some local adaptations; the CNIL supervises.", sources: [cnilOutreMer] },
    quietHours: FRENCH_HOURS,
    optOutWords: FRENCH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "MF",
    email: { text: "French law (CPCE art. L34-5) requires prior opt-in consent for marketing email to individuals; the only exception is existing customers, for similar products, if they could refuse when you collected the address and can in every message. Each email must name the sender and offer a free, easy opt-out.", sources: [cnilProspection, cnilClients] },
    sms: { text: "The same opt-in rule covers marketing texts; existing customers may get texts about similar products only if they could refuse at collection and in every text.", sources: [cnilProspection, cnilClients] },
    calls: { text: "Since 11 August 2026 sales calls to consumers need their prior consent (the Bloctel opt-out list has ended), and automated or AI-voice sales calls need consent too. Calls are allowed only Monday–Friday 10:00–13:00 and 14:00–20:00, never on weekends or public holidays, and at most 4 times in 30 days.", sources: [dgccrfConsent, prefectureConsent, dgccrfHours, cnilProspection] },
    privacy: { text: "Saint-Martin is part of the EU, so the GDPR applies in full: have a lawful basis, give a privacy notice, honor access and deletion requests, and report serious breaches to the CNIL within 72 hours.", sources: [gdpr, cnilOutreMer] },
    quietHours: FRENCH_HOURS,
    optOutWords: FRENCH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "PM",
    email: { text: "Saint-Pierre-et-Miquelon follows French marketing law: prior opt-in consent for marketing email to individuals (CPCE art. L34-5), except existing customers for similar products who could refuse; name the sender and offer a free opt-out.", sources: [cnilProspection, cnilOutreMer] },
    sms: { text: "The same opt-in rule covers marketing texts; honor STOP and ARRÊT.", sources: [cnilProspection] },
    calls: { text: "French rules apply: sales calls to consumers need prior consent since 11 August 2026, only Monday–Friday 10:00–13:00 and 14:00–20:00, at most 4 times in 30 days.", sources: [dgccrfConsent, dgccrfHours] },
    privacy: { text: "Saint-Pierre-et-Miquelon isn't part of the EU, but France's data protection law applies there and gives effect to GDPR-equivalent rules, with some local adaptations; the CNIL supervises.", sources: [cnilOutreMer] },
    quietHours: FRENCH_HOURS,
    optOutWords: FRENCH,
    smsConsent: "express",
    emailConsent: "express",
  },
  {
    country: "GL",
    email: { text: "Greenland isn't in the EU and no Greenlandic anti-spam rule was confirmed; a new marketing act modeled on Danish law was before Inatsisartut in 2026. Use the Danish standard: opt-in consent for marketing email and texts, with an exception for existing customers buying similar products.", sources: [greenlandMarketingBill, danishSpamGuide] },
    sms: { text: "Use the Danish opt-in standard for marketing texts; honor STOP and AFMELD.", sources: [greenlandMarketingBill, danishSpamGuide] },
    calls: { text: "No do-not-call registry; call only customers or people who asked, between 9:00 and 20:00, say who you are, and stop when asked.", sources: [greenlandMarketingBill] },
    privacy: { text: "Greenland has its own version of Denmark's data protection act (in force since 1 December 2016), supervised by the Danish Data Protection Agency; the GDPR doesn't apply directly.", sources: [dgGreenland] },
    quietHours: COURTEOUS_HOURS,
    optOutWords: ["AFMELD"],
    smsConsent: "express",
    emailConsent: "express",
  },
];

/** Rules that apply everywhere the software works. */
export const GENERAL: { reviews: Rule; whatsapp: Rule; aiDisclosure: Rule; a2p10dlc: Rule } = {
  reviews: {
    text: "Ask every customer for a review the same way: no review gating (screening out unhappy customers before asking for a public review) and no rewards for reviews. Google bans incentives to post, change or remove reviews and bans selectively soliciting positive ones; profiles that break the rules can lose reviews or be blocked from getting new ones. In the US the FTC's reviews rule (in force since 21 October 2024) bans buying reviews, incentives tied to a review's sentiment, fake and insider reviews, and suppressing negative ones, and its Endorsement Guides say gating can be deceptive; Canada's Competition Bureau treats fake or undisclosed employee reviews as misleading advertising.",
    sources: [googleFakeEngagement, googleReviewTips, cfr465, cfr465_4, ftcReviewsQa, cfr255_2, compBureauEmployees],
  },
  whatsapp: {
    text: "WhatsApp requires an opt-in that makes clear the person agrees to hear from your business, and you must honor requests to stop. You can reply freely within 24 hours of the customer's last message; outside that window you can only send pre-approved templates, categorized as marketing, utility or authentication. Meta charges per delivered template message by category and country (since 1 July 2025); since 1 October 2026 it also charges utility and service messages inside the 24-hour window beyond a free monthly allowance. Marketing templates still aren't delivered to US (+1) numbers.",
    sources: [waOptIn, waPolicy, waTemplates, waPricing, waPricingUpdates, waUsPause],
  },
  aiDisclosure: {
    text: "The AI agent always answers truthfully when asked whether it's a person, and should say it's an AI assistant for the business at the start of every call. In the US, outbound AI-voice calls count as \"artificial voice\" calls (FCC, February 2024), so they need consent and must name the business. California bans bots that hide their identity to sell online, Utah requires generative AI to say it isn't human when a consumer asks, and Maine bans AI chatbots that could mislead people into thinking they're talking to a human. In the EU's Caribbean regions (Guadeloupe, Martinique, Saint-Martin) the AI Act has required telling people they're talking to an AI since 2 August 2026.",
    sources: [fccAiVoice, cfr64_1200, caBot, utAi, meAi, euAiAct],
  },
  a2p10dlc: {
    text: "To text US numbers from a US local (10-digit) number, register your brand and campaign through Twilio with The Campaign Registry; Twilio has blocked all unregistered US 10DLC traffic since 1 September 2023. Toll-free numbers need toll-free verification instead; unverified ones have been blocked from texting the US and Canada since 31 January 2024. Registration asks for your opt-in flow, sample messages and opt-out handling, so set those up first and allow days to weeks for approval.",
    sources: [twilio10dlcBlock, twilio10dlcShutdown, twilioTollFree],
  },
};
