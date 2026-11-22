// Wages for the jobs the seven services replace, by country, with sources.
// Checked on 2026-11-22. Method and caveats: docs/labor-costs.md.
// Pure data: no imports, loadable by Node's type stripping in tests.

export type RoleId = "receptionist" | "lead_responder" | "appointment_setter" | "review_coordinator" | "web_designer" | "sales_trainer" | "media_buyer";

export interface WageSource { label: string; url: string }

export interface MarketWages {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** ISO 4217 lowercase: the currency the wages are in. */
  currency: string;
  /** Hourly wage in local currency for each role (median or typical, before employer costs). */
  hourly: Record<RoleId, number>;
  /** Employer cost on top of wages, as a multiplier (1.25 = 25% more). */
  burden: number;
  /** "survey": role-level wage data; "estimate": derived from the minimum wage or another proxy. */
  basis: "survey" | "estimate";
  /** One or two sentences: how the numbers were derived. */
  method: string;
  sources: WageSource[];
  /** Year the underlying data describes. */
  year: number;
}

export const WAGES_CHECKED_ON = "2026-11-22";

// Estimates use these role factors on the hourly minimum wage (or proxy):
// receptionist 1.3, lead_responder 1.4, appointment_setter 1.2,
// review_coordinator 1.3, web_designer 3, sales_trainer 3, media_buyer 3.
// Monthly minimums are turned into hourly with the legal week:
// 40 h = 173.33 h/month, 44 h = 190.67, 48 h = 208.

export const WAGES: MarketWages[] = [
  // ---------------------------------------------------------------- North America
  {
    country: "CA",
    currency: "cad",
    hourly: { receptionist: 21.0, lead_responder: 22.0, appointment_setter: 19.0, review_coordinator: 23.99, web_designer: 33.65, sales_trainer: 45.0, media_buyer: 35.58 },
    burden: 1.13,
    basis: "survey",
    method: "Job Bank national median hourly wages (updated 19 Nov 2025 from Labour Force Survey 2023-2024 data) for NOC 14101, 64409, 65109 (telemarketers), 14100 (general office), 21233, 41210 (company trainers) and 11202. Burden: CPP 5.95% + EI 2.28% (2026 employer rates) + 4% vacation pay + about 1% workers' compensation; Quebec differs slightly.",
    sources: [
      { label: "Job Bank: Receptionist (NOC 14101), Canada", url: "https://www.jobbank.gc.ca/marketreport/wages-occupation/24391/ca" },
      { label: "Job Bank: Customer Service Agent (NOC 64409), Canada", url: "https://www.jobbank.gc.ca/marketreport/wages-occupation/15216/ca" },
      { label: "Job Bank: Telemarketer (NOC 65109), Canada", url: "https://www.jobbank.gc.ca/marketreport/wages-occupation/2886/ca" },
      { label: "Job Bank: Clerk, General Office (NOC 14100), Canada", url: "https://www.jobbank.gc.ca/marketreport/wages-occupation/12604/ca" },
      { label: "Job Bank: Web Designer (NOC 21233), Canada", url: "https://www.jobbank.gc.ca/marketreport/wages-occupation/17898/ca" },
      { label: "Job Bank: Company Trainer (NOC 41210), Canada", url: "https://www.jobbank.gc.ca/marketreport/summary-occupation/22879/ca" },
      { label: "Job Bank: Marketing Coordinator (NOC 11202), Canada", url: "https://www.jobbank.gc.ca/marketreport/wages-occupation/27114/ca" },
      { label: "Job Bank: wage methodology", url: "https://www.jobbank.gc.ca/trend-analysis/search-wages/wage-methodology" },
      { label: "ESDC: 2026 EI premium rate ($1.63 employee, $2.28 employer per $100)", url: "https://www.canada.ca/en/employment-social-development/news/2025/09/canada-employment-insurance-commission-sets-the-2026-employment-insurance-premium-rate.html" },
      { label: "Memorial University: 2026 payroll rates (CPP 5.95%, YMPE $74,600)", url: "https://www.mun.ca/hr/media/production/memorial/administrative/human-resources/media-library/services/2026-tax-changes.pdf" },
    ],
    year: 2024,
  },
  {
    country: "US",
    currency: "usd",
    hourly: { receptionist: 18.27, lead_responder: 21.53, appointment_setter: 17.04, review_coordinator: 21.64, web_designer: 50.0, sales_trainer: 33.31, media_buyer: 37.87 },
    burden: 1.1,
    basis: "survey",
    method: "BLS OEWS May 2025 national median hourly wage for SOC 43-4171, 43-4051, 41-9041, 43-9061 (Office Clerks, General, for review_coordinator), 15-1255, 13-1151 and 13-1161. Burden: BLS ECEC June 2026, private industry, legally required benefits (Social Security, Medicare, federal and state unemployment, workers' comp) of $3.40 per hour on $32.82 of wages.",
    sources: [
      { label: "BLS OEWS May 2025, Table 1 (national wages by occupation)", url: "https://www.bls.gov/news.release/ocwage.t01.htm" },
      { label: "BLS OEWS 43-4171 Receptionists and Information Clerks", url: "https://www.bls.gov/oes/current/oes434171.htm" },
      { label: "BLS OOH: Receptionists", url: "https://www.bls.gov/ooh/office-and-administrative-support/receptionists.htm" },
      { label: "BLS OEWS 43-4051 Customer Service Representatives", url: "https://www.bls.gov/oes/current/oes434051.htm" },
      { label: "BLS OOH: Customer Service Representatives", url: "https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm" },
      { label: "BLS OEWS 41-9041 Telemarketers", url: "https://www.bls.gov/oes/current/oes419041.htm" },
      { label: "O*NET national wages 41-9041 (BLS 2025 data)", url: "https://www.onetonline.org/link/localwages/41-9041.00" },
      { label: "BLS OEWS 43-9061 Office Clerks, General", url: "https://www.bls.gov/oes/current/oes439061.htm" },
      { label: "BLS OOH: General Office Clerks", url: "https://www.bls.gov/ooh/office-and-administrative-support/general-office-clerks.htm" },
      { label: "BLS OEWS 15-1255 Web and Digital Interface Designers", url: "https://www.bls.gov/oes/current/oes151255.htm" },
      { label: "BLS OOH: Web Developers and Digital Designers", url: "https://www.bls.gov/ooh/computer-and-information-technology/web-developers.htm" },
      { label: "O*NET national wages 15-1255 (BLS 2025 data)", url: "https://www.onetonline.org/link/localwages/15-1255.00" },
      { label: "BLS OEWS 13-1151 Training and Development Specialists", url: "https://www.bls.gov/oes/current/oes131151.htm" },
      { label: "BLS OOH: Training and Development Specialists", url: "https://www.bls.gov/ooh/business-and-financial/training-and-development-specialists.htm" },
      { label: "BLS OEWS 13-1161 Market Research Analysts and Marketing Specialists", url: "https://www.bls.gov/oes/current/oes131161.htm" },
      { label: "BLS OOH: Market Research Analysts", url: "https://www.bls.gov/ooh/business-and-financial/market-research-analysts.htm" },
      { label: "BLS ECEC June 2026, Table 1", url: "https://www.bls.gov/news.release/ecec.t01.htm" },
    ],
    year: 2025,
  },
  {
    country: "MX",
    currency: "mxn",
    hourly: { receptionist: 46.04, lead_responder: 46.04, appointment_setter: 46.04, review_coordinator: 46.04, web_designer: 52.88, sales_trainer: 58.17, media_buyer: 62.5 },
    burden: 1.33,
    basis: "survey",
    method: "INEGI ENOE average monthly pay by occupation (2026-Q1, via DataMexico) divided by 208 hours (48-hour week); where the average is below the 2026 general minimum wage (MXN 315.04/day = 46.04/hour with the paid rest day) the minimum is used, because ENOE includes part-time and informal workers. Burden: IMSS, 5% INFONAVIT, about 3% state payroll tax, 15-day aguinaldo and 25% vacation premium (about 1.33 at minimum-wage pay).",
    sources: [
      { label: "DataMexico: Recepcionistas, trabajadores que brindan informacion y telefonistas (321)", url: "https://www.economia.gob.mx/datamexico/es/profile/occupation/recepcionistas-trabajadores-que-brindan-informacion-y-telefonistas" },
      { label: "DataMexico: Vendedores por telefono (4213)", url: "https://www.economia.gob.mx/datamexico/es/profile/occupation/vendedores-por-telefono" },
      { label: "DataMexico: Auxiliares en administracion, mercadotecnia y comercializacion (2511)", url: "https://www.economia.gob.mx/datamexico/es/profile/occupation/auxiliares-en-administracion-mercadotecnia-comercializacion-y-comercio-exterior" },
      { label: "DataMexico: Desarrolladores y analistas de software y multimedia (2271)", url: "https://www.economia.gob.mx/datamexico/es/profile/occupation/desarrolladores-y-analistas-de-software-y-multimedia" },
      { label: "DataMexico: Coordinadores y jefes de area en administracion, RR. HH. y mercadotecnia (1511)", url: "https://www.economia.gob.mx/datamexico/es/profile/occupation/coordinadores-y-jefes-de-area-en-administracion-recursos-humanos-y-mercadotecnia" },
      { label: "DataMexico: Especialistas y consultores en mercadotecnia y publicidad (2112)", url: "https://www.economia.gob.mx/datamexico/es/profile/occupation/especialistas-y-consultores-en-mercadotecnia-publicidad-comunicacion-y-comercio-exterior" },
      { label: "CONASAMI (Comision Nacional de los Salarios Minimos)", url: "https://www.gob.mx/conasami" },
      { label: "EY Mexico: 2026 minimum wages (DOF 9 Dec 2025: 315.04 general, 440.87 border zone)", url: "https://www.ey.com/es_mx/technical/tax/boletines-fiscales/incremento-salarios-minimos-2026" },
      { label: "Praxium: cost of a minimum-wage employee to the employer, 2026", url: "https://praxiumconsultores.com/blog/costo-de-un-empleado-con-salario-minimo-2026-para-el-patron" },
    ],
    year: 2026,
  },
  // ---------------------------------------------------------------- Central America
  {
    country: "GT",
    currency: "gtq",
    hourly: { receptionist: 28.99, lead_responder: 31.22, appointment_setter: 26.76, review_coordinator: 28.99, web_designer: 66.91, sales_trainer: 66.91, media_buyer: 66.91 },
    burden: 1.29,
    basis: "estimate",
    method: "2026 non-agricultural minimum for the department of Guatemala (Q131.58/day, Q4,002.28/month, Acuerdo Gubernativo 256-2025) plus the mandatory Q250 incentive bonus, divided by 190.67 hours (44-hour week) = Q22.30/hour, times the role factors. Burden: IGSS 10.67% + IRTRA 1% + INTECAP 1% + aguinaldo and Bono 14 (one month's pay each).",
    sources: [
      { label: "AGN: 2026 minimum wage amounts", url: "https://agn.gt/asi-quedan-los-montos-del-salario-minimo-para-el-2026/" },
      { label: "EY: Guatemala minimum wage 2026", url: "https://www.ey.com/es_ce/technical/tax/tax-alerts/guatemala-salario-minimo-2026" },
      { label: "La Hora: what a minimum-wage job really costs an employer in 2026", url: "https://lahora.gt/lh-economia/hloarca/2026/01/03/cuanto-cuesta-realmente-a-una-empresa-en-guatemala-crear-una-plaza-con-salario-minimo-en-2026/" },
    ],
    year: 2026,
  },
  {
    country: "BZ",
    currency: "bzd",
    hourly: { receptionist: 6.5, lead_responder: 7.0, appointment_setter: 6.0, review_coordinator: 6.5, web_designer: 15.0, sales_trainer: 15.0, media_buyer: 15.0 },
    burden: 1.06,
    basis: "estimate",
    method: "National minimum wage BZ$5.00/hour (in force since 1 Jan 2023; the announced rise to BZ$6.00 had no date in 2026) times the role factors. Burden: employer Social Security contribution, 5.5% of insurable pay at the top band and a larger share at low pay.",
    sources: [
      { label: "Government of Belize: minimum wage $5.00/hour from 1 Jan 2023", url: "https://www.pressoffice.gov.bz/minimum-wage-increases-for-all-categories-of-workers/" },
      { label: "WageIndicator: Belize minimum wage", url: "https://wageindicator.org/salary/minimum-wage/belize" },
      { label: "Social Security Board: contribution schedule from 4 Apr 2022", url: "https://www.socialsecurity.org.bz/wp-content/uploads/2021/12/Apr-2022_cont_ben_F.pdf" },
    ],
    year: 2026,
  },
  {
    country: "SV",
    currency: "usd",
    hourly: { receptionist: 2.79, lead_responder: 3.0, appointment_setter: 2.57, review_coordinator: 2.79, web_designer: 6.43, sales_trainer: 6.43, media_buyer: 6.43 },
    burden: 1.22,
    basis: "estimate",
    method: "Commerce and services minimum US$408.80/month (Decreto Ejecutivo 11, from 1 Jun 2025; no 2026 change) divided by 190.67 hours (44-hour week) = $2.14/hour, times the role factors. Burden: ISSS 7.5% + AFP 8.75% + 15-day aguinaldo + 30% premium on 15 vacation days; INSAFORP (1%, only with 10+ staff) is left out.",
    sources: [
      { label: "EY: El Salvador minimum wage 2026", url: "https://www.ey.com/es_ce/technical/tax/tax-alerts/el-salvador-salario-minimo-2026" },
      { label: "Diario Oficial: Decreto Ejecutivo on minimum wages (May 2025)", url: "https://www.jurisprudencia.gob.sv/DocumentosBoveda/D/2/2020-2029/2025/05/10A4DA.PDF" },
      { label: "FiniquitoJusto: El Salvador payroll deductions 2026 (ISSS, AFP)", url: "https://finiquitojusto.com/?p=4011" },
      { label: "PwC: El Salvador other taxes", url: "https://taxsummaries.pwc.com/el-salvador/individual/other-taxes" },
    ],
    year: 2026,
  },
  {
    country: "HN",
    currency: "hnl",
    hourly: { receptionist: 90.63, lead_responder: 97.6, appointment_setter: 83.66, review_coordinator: 90.63, web_designer: 209.14, sales_trainer: 209.14, media_buyer: 209.14 },
    burden: 1.26,
    basis: "estimate",
    method: "2026 minimum for wholesale and retail commerce, firms with 1-10 workers (L13,292.06/month, Acuerdo SETRASS 233-2026) divided by 190.67 hours (44-hour week) = L69.71/hour, times the role factors. Burden: IHSS about 7%, RAP 1.5%, INFOP 1%, plus the 13th and 14th month salaries.",
    sources: [
      { label: "Acuerdo SETRASS 233-2026 (La Gaceta)", url: "https://www.tsc.gob.hn/web/leyes/Acuerdo-SETRASS-233-2026.pdf" },
      { label: "Bloomberg Linea: Honduras 2026 minimum wage table", url: "https://www.bloomberglinea.com/latinoamerica/honduras/salario-minimo-2026-en-honduras-estos-son-los-nuevos-montos-por-actividad-economica/" },
      { label: "Cazvid: hiring in Honduras 2026 (employer contributions)", url: "https://cazvid.com/es/blog/como-contratar-personal-en-honduras-guia-legal" },
      { label: "PwC: Honduras other taxes (INFOP)", url: "https://taxsummaries.pwc.com/honduras/corporate/other-taxes" },
    ],
    year: 2026,
  },
  {
    country: "NI",
    currency: "nio",
    hourly: { receptionist: 70.94, lead_responder: 76.39, appointment_setter: 65.48, review_coordinator: 70.94, web_designer: 163.7, sales_trainer: 163.7, media_buyer: 163.7 },
    burden: 1.32,
    basis: "estimate",
    method: "Minimum for commerce, restaurants and hotels from 1 Mar 2026 (C$11,350.08/month) divided by 208 hours (48-hour week) = C$54.57/hour, times the role factors. Burden: INSS employer 21.5% (under 50 staff) + INATEC 2% + aguinaldo (13th month).",
    sources: [
      { label: "WageIndicator: Nicaragua minimum wage from 1 Mar 2026", url: "https://wageindicator.org/work/minimum-wage/updates/2026/minimum-wage-updated-in-nicaragua-from-01-march-2026-march-11-2026" },
      { label: "Bloomberg Linea: Nicaragua 2026 minimum wages (+4%)", url: "https://www.bloomberglinea.com/2026/03/06/salario-minimo-en-nicaragua-2026-estos-son-los-nuevos-montos-tras-el-aumento-del-4/" },
      { label: "Niural: hiring in Nicaragua (INSS, INATEC)", url: "https://www.niural.com/blog/hiring-in-nicaragua-minimum-wage-and-employment-guide" },
    ],
    year: 2026,
  },
  {
    country: "CR",
    currency: "crc",
    hourly: { receptionist: 2331.83, lead_responder: 2511.2, appointment_setter: 2152.46, review_coordinator: 2331.83, web_designer: 5381.14, sales_trainer: 5381.14, media_buyer: 5381.14 },
    burden: 1.36,
    basis: "estimate",
    method: "2026 minimum for a generic unskilled worker (TNCG, 373,092.42 colones/month, Decreto 45303-MTSS) divided by 208 hours (48-hour week) = 1,793.71/hour, times the role factors. Burden: CCSS employer charges 26.83% (2026) + aguinaldo 8.33% + about 1% mandatory INS work-risk insurance.",
    sources: [
      { label: "EY: Costa Rica minimum wage 2026", url: "https://www.ey.com/es_ce/technical/tax/tax-alerts/costa-rica-salario-minimo-2026" },
      { label: "WageIndicator: Costa Rica minimum wage", url: "https://wageindicator.org/es-cr/ai/trabajo-en-costa-rica/salario-minimo/" },
      { label: "EY: employer social charges from January 2026 (26.83%)", url: "https://www.ey.com/es_ce/technical/tax/tax-alerts/costa-rica-aumento-en-cuotas-obrero-patronales-aplicable-desde-enero-20261" },
    ],
    year: 2026,
  },
  {
    country: "PA",
    currency: "usd",
    hourly: { receptionist: 3.08, lead_responder: 3.32, appointment_setter: 2.84, review_coordinator: 3.08, web_designer: 7.11, sales_trainer: 7.11, media_buyer: 7.11 },
    burden: 1.25,
    basis: "estimate",
    method: "Region 1 retail-commerce minimum for small companies, B/.2.37/hour (Decreto Ejecutivo 13 of 2025, from 16 Jan 2026; large companies B/.3.02), times the role factors; the small-company rate comes from secondary tables. Burden: CSS employer 13.25% (Apr 2025 to Feb 2027) + 1.5% educational insurance + about 1% work-risk + the 13th month with its 10.75% CSS charge.",
    sources: [
      { label: "La Prensa: 2026 minimum wage rates by activity and region", url: "https://www.prensa.com/economia/salario-minimo-2026-en-panama-estas-son-las-nuevas-tarifas-por-actividad-y-region/" },
      { label: "Claviweb: Decreto Ejecutivo 13 minimum wage table", url: "https://claviweb.com/guias/salario-minimo-panama" },
      { label: "MITRADEL: minimum wage lookup", url: "https://apps.mitradel.gob.pa/SalarioMinimo/" },
      { label: "TVN: CSS employer contribution steps (13.25% from April 2025)", url: "https://www.tvn-2.com/nacionales/reformas-a-la-css-aumento-escalonado-cuota-patronal-caja-de-seguro-social_1_2182102.amp.html" },
    ],
    year: 2026,
  },
  // ---------------------------------------------------------------- Caribbean
  {
    country: "CU",
    currency: "cup",
    hourly: { receptionist: 21.89, lead_responder: 23.58, appointment_setter: 20.21, review_coordinator: 21.89, web_designer: 50.52, sales_trainer: 50.52, media_buyer: 50.52 },
    burden: 1.19,
    basis: "estimate",
    method: "National minimum wage 3,210 CUP/month = 16.84 CUP/hour (Resolucion 14/2026, from 1 Jul 2026) times the role factors; private businesses (mipymes) usually pay far more. Burden: 14% social-security contribution + 5% tax on use of the labour force.",
    sources: [
      { label: "Periodico Cubano: new minimum wage in force", url: "https://www.periodicocubano.com/en-vigor-nuevo-salario-minimo-en-cuba-pero-los-trabajadores-deben-esperar-para-cobrarlo/?amp=1" },
      { label: "CiberCuba: what the new minimum wage buys", url: "https://en.cibercuba.com/noticias/2026-06-20-u1-e208574-s27061-nid332827-podra-comprar-cuba-nuevo-salario-minimo-ni-carton" },
      { label: "Periodico Cubano: Gaceta Oficial, the 17 taxes for 2026", url: "https://www.periodicocubano.com/gaceta-oficial-publica-los-17-impuestos-que-se-cobraran-en-cuba-durante-el-2026/?amp=1" },
    ],
    year: 2026,
  },
  {
    country: "JM",
    currency: "jmd",
    hourly: { receptionist: 552.5, lead_responder: 595.0, appointment_setter: 510.0, review_coordinator: 552.5, web_designer: 1275.0, sales_trainer: 1275.0, media_buyer: 1275.0 },
    burden: 1.13,
    basis: "estimate",
    method: "National minimum wage J$17,000 per 40-hour week (J$425/hour) from 1 Jul 2026, times the role factors. Burden: employer NIS 3% + NHT 3% + Education Tax 3.5% + HEART/NSTA 3%.",
    sources: [
      { label: "JIS: minimum wage moves to $17,000 on July 1", url: "https://jis.gov.jm/minimum-wage-moves-to-17000-on-july-1/" },
      { label: "PwC: Jamaica other taxes (payroll contributions)", url: "https://taxsummaries.pwc.com/jamaica/corporate/other-taxes" },
    ],
    year: 2026,
  },
  {
    country: "HT",
    currency: "htg",
    hourly: { receptionist: 123.5, lead_responder: 133.0, appointment_setter: 114.0, review_coordinator: 123.5, web_designer: 285.0, sales_trainer: 285.0, media_buyer: 285.0 },
    burden: 1.17,
    basis: "estimate",
    method: "Minimum wage from 6 May 2026 for segment C (retail, restaurants), 760 HTG per 8-hour day = 95 HTG/hour, times the role factors; banks and insurers (segment A) pay 1,000 HTG/day. Burden: ONA pension 6% + OFATMA about 3% + the year-end bonus of one month's pay.",
    sources: [
      { label: "HaitiLibre: new minimum wages for all sectors (official 2026)", url: "https://www.haitilibre.com/en/news-47534-flash-new-minimum-wages-in-haiti-for-all-sectors-of-activity-official-2026.html" },
      { label: "WageIndicator: Haiti minimum wages", url: "https://wageindicator.org/fr-ht/travail-en-haiti/salaire-minimum" },
      { label: "Rivermate: Haiti employee benefits (ONA, OFATMA, 13th month)", url: "https://www.rivermate.com/guides/haiti/benefits" },
    ],
    year: 2026,
  },
  {
    country: "DO",
    currency: "dop",
    hourly: { receptionist: 115.86, lead_responder: 124.78, appointment_setter: 106.95, review_coordinator: 115.86, web_designer: 267.38, sales_trainer: 267.38, media_buyer: 267.38 },
    burden: 1.25,
    basis: "estimate",
    method: "Non-sectorized private minimum for micro-enterprises from 1 Feb 2026 (RD$16,993.20/month, Resolucion CNS-01-2025; small RD$18,421.20, large RD$29,988) divided by 190.67 hours (44-hour week) = RD$89.13/hour, times the role factors. Burden: TSS employer AFP 7.10% + SFS 7.09% + SRL about 1.1% + INFOTEP 1% + Christmas salary (13th month).",
    sources: [
      { label: "Bloomberg Linea: DR minimum wage, 20% rise in 2025-2026", url: "https://www.bloomberglinea.com/latinoamerica/republica-dominicana/salario-minimo-en-republica-dominicana-de-cuanto-es-el-20-de-aumento-en-2025-y-2026/" },
      { label: "Presidencia: Ministry of Labour on the 8% February 2026 increase", url: "https://presidencia.gob.do/noticias/ministerio-de-trabajo-llama-empresarios-cumplir-con-el-pago-del-aumento-del-8-del-salario" },
      { label: "Siempre al Dia: DR payroll and TSS contributions", url: "https://siemprealdia.co/republica-dominicana/derecho-laboral/gestion-de-nominas-y-seguridad-social/" },
    ],
    year: 2026,
  },
  {
    country: "BS",
    currency: "bsd",
    hourly: { receptionist: 8.45, lead_responder: 9.1, appointment_setter: 7.8, review_coordinator: 8.45, web_designer: 19.5, sales_trainer: 19.5, media_buyer: 19.5 },
    burden: 1.07,
    basis: "estimate",
    method: "National minimum wage B$6.50/hour (B$260/week, since 1 Jan 2023; no 2026 increase found) times the role factors. Burden: NIB employer contribution 6.65% (from 1 Jul 2024).",
    sources: [
      { label: "WageIndicator: Bahamas minimum wage", url: "https://wageindicator.org/en-bs/work-in-bahamas/minimum-wage/" },
      { label: "NIB: contributions", url: "https://www.nib-bahamas.com/Contributions" },
    ],
    year: 2026,
  },
  {
    country: "BB",
    currency: "bbd",
    hourly: { receptionist: 13.92, lead_responder: 14.99, appointment_setter: 12.85, review_coordinator: 13.92, web_designer: 32.13, sales_trainer: 32.13, media_buyer: 32.13 },
    burden: 1.13,
    basis: "estimate",
    method: "National minimum wage BBD 10.71/hour (2% indexation from 21 Jan 2026) times the role factors. Burden: employer NIS 12.75% plus the 0.25% Resilience and Regeneration Fund levy.",
    sources: [
      { label: "WageIndicator: Barbados minimum wage from 21 Jan 2026", url: "https://wageindicator.org/work/minimum-wage/updates/2026/minimum-wage-updated-in-barbados-from-21-january-2026-february-09-2026" },
      { label: "NIS Barbados: rates and contributions", url: "https://www.nis.gov.bb/rates-and-contributions/" },
      { label: "Workzoom: Barbados NIS and PAYE guide 2026", url: "https://www.workzoom.com/barbados/compliance/nis-paye/" },
    ],
    year: 2026,
  },
  {
    country: "TT",
    currency: "ttd",
    hourly: { receptionist: 26.65, lead_responder: 28.7, appointment_setter: 24.6, review_coordinator: 26.65, web_designer: 61.5, sales_trainer: 61.5, media_buyer: 61.5 },
    burden: 1.11,
    basis: "estimate",
    method: "National minimum wage TT$20.50/hour (since 1 Jan 2024; no 2026 change found) times the role factors. Burden: employer NIS share 10.8% (two-thirds of the 16.2% rate from 5 Jan 2026).",
    sources: [
      { label: "WageIndicator: Trinidad and Tobago minimum wage", url: "https://wageindicator.org/en-tt/work-in-trinidad-and-tobago/minimum-wage" },
      { label: "PwC: Trinidad and Tobago other taxes (NIS 16.2%)", url: "https://taxsummaries.pwc.com/trinidad-and-tobago/individual/other-taxes" },
      { label: "Guardian TT: new NIS rates start Jan 5", url: "https://guardian.co.tt/business/new-nis-rates-start-jan-5-6.2.2475691.acc42f8424" },
    ],
    year: 2026,
  },
  {
    country: "AG",
    currency: "xcd",
    hourly: { receptionist: 14.95, lead_responder: 16.1, appointment_setter: 13.8, review_coordinator: 14.95, web_designer: 34.5, sales_trainer: 34.5, media_buyer: 34.5 },
    burden: 1.13,
    basis: "estimate",
    method: "National minimum wage EC$11.50/hour (Minimum Basic Wage Order 2026, from 1 Apr 2026) times the role factors. Burden: employer Social Security 9% + Medical Benefits Scheme 3.5%.",
    sources: [
      { label: "Antigua Newsroom: Labour Department confirms $11.50 from April 1", url: "https://antiguanewsroom.com/labour-department-confirms-11-50-minimum-wage-effective-april-1/" },
      { label: "WageIndicator: Antigua and Barbuda minimum wage from 1 Apr 2026", url: "https://wageindicator.org/work/minimum-wage/updates/2026/minimum-wage-updated-in-antigua-and-barbuda-from-01-april-2026-april-07-2026" },
      { label: "Teamed: Antigua and Barbuda tax and payroll", url: "https://www.teamed.global/country-hiring-guides/antigua-and-barbuda/tax-and-payroll" },
    ],
    year: 2026,
  },
  {
    country: "DM",
    currency: "xcd",
    hourly: { receptionist: 11.7, lead_responder: 12.6, appointment_setter: 10.8, review_coordinator: 11.7, web_designer: 27.0, sales_trainer: 27.0, media_buyer: 27.0 },
    burden: 1.08,
    basis: "estimate",
    method: "National minimum wage EC$9.00/hour (Labour Standards (Minimum Wage) Order 2025, from 1 Dec 2025; cashiers and receptionists EC$9.42) times the role factors. Burden: employer Social Security 8% (2026).",
    sources: [
      { label: "Government of Dominica: new minimum wage structure from 1 Dec 2025", url: "https://pressroomopm.gov.dm/government-of-dominica-announces-new-minimum-wage-structure-effective-december-1-2025/" },
      { label: "Dominica Official Gazette: Minimum Wage Order 2025", url: "https://printery.dominica.gov.dm/Gazettes/Details/5758" },
      { label: "Deloitte: Dominica tax highlights 2026", url: "https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-dominicahighlights-2026.pdf" },
    ],
    year: 2026,
  },
  {
    country: "GD",
    currency: "xcd",
    hourly: { receptionist: 9.0, lead_responder: 9.69, appointment_setter: 8.31, review_coordinator: 9.0, web_designer: 20.77, sales_trainer: 20.77, media_buyer: 20.77 },
    burden: 1.07,
    basis: "estimate",
    method: "Grenada sets minimums by category: clerical workers, cashiers and receptionists EC$1,200/month (SRO 42 of 2023) divided by 173.33 hours (40-hour week) = EC$6.92/hour, times the role factors (call-centre staff have an EC$8.50/hour minimum). Burden: employer NIS 7.25% (2026).",
    sources: [
      { label: "Grenada Minimum Wages Order 2023 (S.R.O. 42 of 2023)", url: "https://nowgrenada.com/wp-content/uploads/2023/12/S.R.O.-42-of-2023-Minimum-Wages-Order.pdf" },
      { label: "Deloitte: Grenada tax highlights 2026", url: "https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-grenadahighlights-2026.pdf" },
      { label: "NIS Grenada", url: "https://nisgrenada.org/" },
    ],
    year: 2026,
  },
  {
    country: "KN",
    currency: "xcd",
    hourly: { receptionist: 16.25, lead_responder: 17.5, appointment_setter: 15.0, review_coordinator: 16.25, web_designer: 37.5, sales_trainer: 37.5, media_buyer: 37.5 },
    burden: 1.1,
    basis: "estimate",
    method: "National minimum wage EC$12.50/hour (from 1 Jul 2025) times the role factors. Burden: employer Social Security 5% + employment injury 1% + severance fund 1% + Housing and Social Development Levy 3%.",
    sources: [
      { label: "WageIndicator: St Kitts and Nevis minimum wage from 1 Jul 2025", url: "https://wageindicator.org/ai/work/minimum-wage/updates/2025/minimum-wage-updated-in-st-kitts-and-nevis-from-01-july-2025-july-06-2025/" },
      { label: "Deloitte: St Kitts and Nevis tax highlights 2026", url: "https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-stkittsandnevishighlights-2026.pdf" },
      { label: "Teamed: St Kitts and Nevis employer cost breakdown", url: "https://www.teamed.global/country-hiring-guides/saint-kitts-and-nevis/cost-breakdown" },
    ],
    year: 2026,
  },
  {
    country: "LC",
    currency: "xcd",
    hourly: { receptionist: 8.48, lead_responder: 9.13, appointment_setter: 7.82, review_coordinator: 8.48, web_designer: 19.56, sales_trainer: 19.56, media_buyer: 19.56 },
    burden: 1.05,
    basis: "estimate",
    method: "National minimum wage EC$6.52/hour (from 1 Oct 2024; unchanged in 2026) times the role factors. Burden: employer NIC 5%.",
    sources: [
      { label: "Government of Saint Lucia: implementation of the national minimum wage", url: "https://www.govt.lc/news/implementation-of-the-national-minimum-wage" },
      { label: "Deloitte: Saint Lucia tax highlights 2026", url: "https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-stluciahighlights-2026.pdf" },
      { label: "PwC: Saint Lucia other taxes", url: "https://taxsummaries.pwc.com/saint-lucia/individual/other-taxes" },
    ],
    year: 2026,
  },
  {
    country: "VC",
    currency: "xcd",
    hourly: { receptionist: 9.38, lead_responder: 10.1, appointment_setter: 8.65, review_coordinator: 9.38, web_designer: 21.63, sales_trainer: 21.63, media_buyer: 21.63 },
    burden: 1.08,
    basis: "estimate",
    method: "No national minimum: office clerks EC$1,250/month (Minimum Wages Order in Gazette 11 of 2024, from 1 Mar 2024) divided by 173.33 hours (40-hour week) = EC$7.21/hour, times the role factors. Burden: employer NIS 7.5% (2026).",
    sources: [
      { label: "WageIndicator: SVG minimum wage, offices of professionals", url: "https://wageindicator.org/salary/minimum-wage/st-vincent-and-the-grenadines/39494-offices-of-professionals" },
      { label: "One News St Vincent: NIS increase from 1 Jan 2026", url: "https://onenewsstvincent.com/2025/12/30/all-employers-and-employees-reminded-of-nis-increase-from-jan-1-2026/" },
      { label: "NIS SVG: contribution rates", url: "https://www.nissvg.org/rates/" },
    ],
    year: 2026,
  },
  {
    country: "KY",
    currency: "kyd",
    hourly: { receptionist: 11.38, lead_responder: 12.25, appointment_setter: 10.5, review_coordinator: 11.38, web_designer: 26.25, sales_trainer: 26.25, media_buyer: 26.25 },
    burden: 1.12,
    basis: "estimate",
    method: "National minimum wage CI$8.75/hour (from 1 Jan 2026) times the role factors. Burden: 5% employer pension plus the employer's share (usually half) of the mandatory standard health insurance, taken as about 7% of a low wage; the health part is not sourced to a premium table.",
    sources: [
      { label: "Cayman Islands Government: new minimum wage from 1 Jan 2026", url: "https://gov.ky/w/new-minimum-wage-effective-1-january-2026" },
      { label: "PwC: Cayman Islands other issues (pension, health insurance)", url: "https://taxsummaries.pwc.com/cayman-islands/individual/other-issues" },
      { label: "CICBD: hire and manage employees", url: "https://www.cicbd.gov.ky/hire-and-manage-employees" },
    ],
    year: 2026,
  },
  {
    country: "BM",
    currency: "bmd",
    hourly: { receptionist: 22.27, lead_responder: 23.98, appointment_setter: 20.56, review_coordinator: 22.27, web_designer: 51.39, sales_trainer: 51.39, media_buyer: 51.39 },
    burden: 1.2,
    basis: "estimate",
    method: "Minimum hourly wage BMD 17.13 (from 1 Sep 2025) times the role factors. Burden is a rough estimate: employer payroll tax (1% to about 7% by employer class), social insurance BMD 39.25/week, 5% pension, and at least half of a health-insurance premium (premium not sourced).",
    sources: [
      { label: "Government of Bermuda: minimum wage $17.13 from 1 Sep 2025", url: "https://www.gov.bm/news/public-reminder-minimum-wage-increase-take-effect-september-1-2025" },
      { label: "PwC: Bermuda other taxes (social insurance)", url: "https://taxsummaries.pwc.com/bermuda/individual/other-taxes" },
      { label: "Government of Bermuda: payroll tax", url: "https://www.gov.bm/payroll-tax" },
    ],
    year: 2026,
  },
  {
    country: "TC",
    currency: "usd",
    hourly: { receptionist: 10.4, lead_responder: 11.2, appointment_setter: 9.6, review_coordinator: 10.4, web_designer: 24.0, sales_trainer: 24.0, media_buyer: 24.0 },
    burden: 1.1,
    basis: "estimate",
    method: "National minimum wage US$8.00/hour (since 1 Apr 2023; from secondary sources, no 2026 change found) times the role factors. Burden: NIB employer 6.5% + National Health Insurance Plan employer 3%.",
    sources: [
      { label: "Chambers: Investing In 2026, Turks and Caicos", url: "https://gpg-pdf.chambers.com/investing-in-2026/640/" },
      { label: "Rivermate: Turks and Caicos taxes", url: "https://rivermate.com/guides/turks-and-caicos-islands/taxes" },
    ],
    year: 2026,
  },
  {
    country: "VG",
    currency: "usd",
    hourly: { receptionist: 9.43, lead_responder: 10.15, appointment_setter: 8.7, review_coordinator: 9.43, web_designer: 21.75, sales_trainer: 21.75, media_buyer: 21.75 },
    burden: 1.08,
    basis: "estimate",
    method: "Minimum wage US$7.25/hour (Labour Code (Minimum Basic Wage) Order 2025, from 1 Jul 2025) times the role factors. Burden: Social Security employer 4.5% + National Health Insurance employer 3.75%.",
    sources: [
      { label: "Government of the Virgin Islands: new minimum wage from July 1", url: "https://www.gov.vg/news/new-minimum-wage-take-effect-july-1" },
      { label: "Harneys: new BVI national minimum wage", url: "https://www.harneys.com/insights/new-bvi-national-minimum-wage-announced/" },
      { label: "Global Expansion: BVI employer costs", url: "https://www.globalexpansion.com/countrypedia/british-virgin-islands" },
    ],
    year: 2026,
  },
  {
    country: "AI",
    currency: "xcd",
    hourly: { receptionist: 21.06, lead_responder: 22.68, appointment_setter: 19.44, review_coordinator: 21.06, web_designer: 48.6, sales_trainer: 48.6, media_buyer: 48.6 },
    burden: 1.09,
    basis: "estimate",
    method: "National minimum wage EC$16.20/hour (US$6.00) approved by Executive Council (gazetted start date not confirmed), times the role factors. Burden: Social Security employer 5.75% (2026) + 3% stabilisation levy.",
    sources: [
      { label: "Government of Anguilla: Executive Council paper on the national minimum wage", url: "https://gov.ai/document/2024-04-09-071700_1196259153.pdf" },
      { label: "Anguilla Social Security Board: contributions", url: "https://ssbai.com/contributions.php" },
      { label: "Deloitte: Anguilla tax highlights 2026", url: "https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-anguillahighlights-2026.pdf" },
    ],
    year: 2026,
  },
  {
    country: "MS",
    currency: "xcd",
    hourly: { receptionist: 16.25, lead_responder: 17.5, appointment_setter: 15.0, review_coordinator: 16.25, web_designer: 37.5, sales_trainer: 37.5, media_buyer: 37.5 },
    burden: 1.08,
    basis: "estimate",
    method: "Minimum wage EC$12.50/hour (Minimum Wage Order 2025, SRO 48 of 2025, from 1 Apr 2026) times the role factors. Burden: employer Social Security about 8% (the 2026 step of the 2022 schedule; not confirmed).",
    sources: [
      { label: "Montserrat: Minimum Wage Order 2025 (S.R.O. 48 of 2025)", url: "https://parliament.ms/wp-content/uploads/2026/04/SRO-No.-48-of-2025-Minimum-Wage-Order-2025.pdf" },
      { label: "Montserrat: Social Security (Contributions) Amendment Regulations 2022", url: "https://www.gov.ms/wp-content/uploads/2022/02/SRO-No-8-of-2022-Contributions-Amendment-Regulations.pdf" },
    ],
    year: 2026,
  },
  {
    country: "AW",
    currency: "awg",
    hourly: { receptionist: 15.05, lead_responder: 16.21, appointment_setter: 13.9, review_coordinator: 15.05, web_designer: 34.74, sales_trainer: 34.74, media_buyer: 34.74 },
    burden: 1.23,
    basis: "estimate",
    method: "Statutory minimum AWG 11.58/hour for employees 18+ (from 1 Jan 2026) times the role factors. Burden: employer AOV/AWW 10.5% + AZV 8.9% + sickness insurance 2.65% + about 0.5% accident insurance.",
    sources: [
      { label: "Government of Aruba: minimum hourly wage from 1 Jan 2026", url: "https://www.gobierno.aw/en/introduction-of-a-minimum-hourly-wage-effective-january-1-2026" },
      { label: "Rivermate: Aruba employment cost calculator", url: "https://www.rivermate.com/guides/aruba/employment-cost-calculator" },
    ],
    year: 2026,
  },
  {
    country: "CW",
    currency: "xcg",
    hourly: { receptionist: 15.51, lead_responder: 16.7, appointment_setter: 14.32, review_coordinator: 15.51, web_designer: 35.79, sales_trainer: 35.79, media_buyer: 35.79 },
    burden: 1.21,
    basis: "estimate",
    method: "Statutory minimum Cg 11.93/hour (Regeling indexering minimumloon 2026, from 1 Jan 2026) times the role factors. Burden: employer AOV 9% + AWW 0.5% + BVZ 9.3% + ZV 1.9% + about 0.5% accident insurance.",
    sources: [
      { label: "Government of Curacao: Regeling indexering minimumloon 2026", url: "https://gobiernu.cw/wp-content/uploads/2025/12/236.-MR-indexering-minimumloon-2026.pdf" },
      { label: "Curacao Chronicle: SVB premium rates and income limits for 2026", url: "https://www.curacaochronicle.com/post/local/svb-publishes-pension-amounts-premium-rates-and-income-limits-for-2026" },
      { label: "Orbitax: Curacao social security rates 2026", url: "https://orbitax.com/news/country/article/Curacao-Publishes-Social-Secur-60770" },
    ],
    year: 2026,
  },
  {
    country: "SX",
    currency: "xcg",
    hourly: { receptionist: 14.21, lead_responder: 15.3, appointment_setter: 13.12, review_coordinator: 14.21, web_designer: 32.79, sales_trainer: 32.79, media_buyer: 32.79 },
    burden: 1.16,
    basis: "estimate",
    method: "Statutory minimum XCG 10.93/hour (from 1 Jan 2026) times the role factors. Burden: employer AOV 7% + AWW 0.5% + ZV 8.3% + about 0.5% accident insurance, from older SZV tables (2023 and earlier).",
    sources: [
      { label: "Government of Sint Maarten: minimum hourly wage from 1 Jan 2026", url: "https://www.sintmaartengov.org/news/Pages/Minister-Brug-Announces-Updated-Minimum-Hourly-Wage-Effective-January-1-2026.aspx" },
      { label: "SZV 2023 AOV/AWW premiums and wage limits (via Celery Payroll)", url: "https://www.celerypayroll.com/wp-content/uploads/2024/04/SZV-2023-AOV-AWW-Amounts-Wage-Limits-Web.pdf" },
      { label: "Celery Payroll: social insurances in Sint Maarten", url: "https://support.celerypayroll.com/en/support/solutions/articles/6000166062-what-social-insurances-are-applicable-in-sint-maarten-" },
    ],
    year: 2026,
  },
  {
    country: "BQ",
    currency: "usd",
    hourly: { receptionist: 13.9, lead_responder: 14.97, appointment_setter: 12.83, review_coordinator: 13.9, web_designer: 32.07, sales_trainer: 32.07, media_buyer: 32.07 },
    burden: 1.1,
    basis: "estimate",
    method: "Statutory minimum US$10.69/hour on Bonaire (Sint Eustatius $10.61, Saba $10.66; from 1 Jan 2026) times the role factors. Burden: employer health insurance 9.3% + sickness 0.7% + accident 0.2% + cessantia 0.1% (2025 rates).",
    sources: [
      { label: "Rijksdienst Caribisch Nederland: minimum wage from 1 Jan 2026", url: "https://english.rijksdienstcn.com/latest/news/2025/december/04/new-minimum-wage-child-benefit-and-social-security-benefit-amounts-in-the-caribbean-netherlands-as-of-1-january-2026" },
      { label: "Belastingdienst Caribisch Nederland: notes to the 2025 tables", url: "https://english.belastingdienst-cn.nl/binaries/belastingdienst-cn-en/documenten/leaflets/belastingdienst/lh/tabellen-en-rekenregels-2025/notes-2025/Toelichting_tabellen_1_1_2025.pdf" },
    ],
    year: 2026,
  },
  {
    country: "GP",
    currency: "eur",
    hourly: { receptionist: 16.0, lead_responder: 17.23, appointment_setter: 14.77, review_coordinator: 16.0, web_designer: 36.93, sales_trainer: 36.93, media_buyer: 36.93 },
    burden: 1.15,
    basis: "estimate",
    method: "French SMIC EUR 12.31/hour (from 1 Jun 2026), which applies in Guadeloupe, times the role factors. Burden 1.15 is a blend: the LODEOM exemption and the general reduction remove most employer contributions near the SMIC (about 1.05-1.10 for the four lower-paid roles), while roles at 3x the SMIC carry full contributions (about 1.40+).",
    sources: [
      { label: "info.gouv.fr: SMIC raised on 1 June 2026", url: "https://www.info.gouv.fr/actualite/le-smic-revalorise-le-1er-juin-2026" },
      { label: "Service-Public: minimum wage", url: "https://www.service-public.gouv.fr/particuliers/actualites/A18916" },
      { label: "Prefecture: SMIC 1 Jan 2026 and the territories where it applies", url: "https://www.prefectures-regions.gouv.fr/normandie/Actualites/Revalorisation-annuelle-du-SMIC-au-1er-janvier-2026" },
      { label: "LODEOM exemption (Guadeloupe, Martinique, Guyane, Reunion, Mayotte)", url: "https://les-aides.fr/aide/FTNP3w/urssaf/exoneration-cotisations-lodeom-entreprises-en-guadeloupe-guyane-martinique-reunion.html" },
    ],
    year: 2026,
  },
  {
    country: "MQ",
    currency: "eur",
    hourly: { receptionist: 16.0, lead_responder: 17.23, appointment_setter: 14.77, review_coordinator: 16.0, web_designer: 36.93, sales_trainer: 36.93, media_buyer: 36.93 },
    burden: 1.15,
    basis: "estimate",
    method: "French SMIC EUR 12.31/hour (from 1 Jun 2026), which applies in Martinique, times the role factors. Burden 1.15 is a blend: LODEOM and the general reduction cut employer contributions near the SMIC (about 1.05-1.10 for the lower-paid roles), while roles at 3x the SMIC carry full contributions (about 1.40+).",
    sources: [
      { label: "info.gouv.fr: SMIC raised on 1 June 2026", url: "https://www.info.gouv.fr/actualite/le-smic-revalorise-le-1er-juin-2026" },
      { label: "Prefecture: SMIC 1 Jan 2026 and the territories where it applies", url: "https://www.prefectures-regions.gouv.fr/normandie/Actualites/Revalorisation-annuelle-du-SMIC-au-1er-janvier-2026" },
      { label: "LODEOM exemption (Guadeloupe, Martinique, Guyane, Reunion, Mayotte)", url: "https://les-aides.fr/aide/FTNP3w/urssaf/exoneration-cotisations-lodeom-entreprises-en-guadeloupe-guyane-martinique-reunion.html" },
    ],
    year: 2026,
  },
  {
    country: "BL",
    currency: "eur",
    hourly: { receptionist: 16.0, lead_responder: 17.23, appointment_setter: 14.77, review_coordinator: 16.0, web_designer: 36.93, sales_trainer: 36.93, media_buyer: 36.93 },
    burden: 1.15,
    basis: "estimate",
    method: "French SMIC EUR 12.31/hour (from 1 Jun 2026), which applies in Saint-Barthelemy, times the role factors; real pay on the island is usually well above it. Burden 1.15 is a blend: LODEOM cuts employer contributions near the SMIC (about 1.05-1.10), while roles at 3x the SMIC carry full contributions (about 1.40+).",
    sources: [
      { label: "info.gouv.fr: SMIC raised on 1 June 2026", url: "https://www.info.gouv.fr/actualite/le-smic-revalorise-le-1er-juin-2026" },
      { label: "Prefecture: SMIC 1 Jan 2026 and the territories where it applies", url: "https://www.prefectures-regions.gouv.fr/normandie/Actualites/Revalorisation-annuelle-du-SMIC-au-1er-janvier-2026" },
      { label: "LODEOM exemption (Saint-Barthelemy and Saint-Martin)", url: "https://les-aides.fr/aide/U2cv3w/urssaf/exoneration-cotisations-lodeom-entreprises-a-st-barthelemy-et-a-st-martin.html" },
    ],
    year: 2026,
  },
  {
    country: "MF",
    currency: "eur",
    hourly: { receptionist: 16.0, lead_responder: 17.23, appointment_setter: 14.77, review_coordinator: 16.0, web_designer: 36.93, sales_trainer: 36.93, media_buyer: 36.93 },
    burden: 1.15,
    basis: "estimate",
    method: "French SMIC EUR 12.31/hour (from 1 Jun 2026), which applies in Saint-Martin, times the role factors. Burden 1.15 is a blend: LODEOM cuts employer contributions near the SMIC (about 1.05-1.10 for the lower-paid roles), while roles at 3x the SMIC carry full contributions (about 1.40+).",
    sources: [
      { label: "info.gouv.fr: SMIC raised on 1 June 2026", url: "https://www.info.gouv.fr/actualite/le-smic-revalorise-le-1er-juin-2026" },
      { label: "Prefecture: SMIC 1 Jan 2026 and the territories where it applies", url: "https://www.prefectures-regions.gouv.fr/normandie/Actualites/Revalorisation-annuelle-du-SMIC-au-1er-janvier-2026" },
      { label: "LODEOM exemption (Saint-Barthelemy and Saint-Martin)", url: "https://les-aides.fr/aide/U2cv3w/urssaf/exoneration-cotisations-lodeom-entreprises-a-st-barthelemy-et-a-st-martin.html" },
    ],
    year: 2026,
  },
  {
    country: "PM",
    currency: "eur",
    hourly: { receptionist: 16.0, lead_responder: 17.23, appointment_setter: 14.77, review_coordinator: 16.0, web_designer: 36.93, sales_trainer: 36.93, media_buyer: 36.93 },
    burden: 1.25,
    basis: "estimate",
    method: "French SMIC (EUR 12.02/hour from 1 Jan 2026, listed for Saint-Pierre-et-Miquelon; EUR 12.31 from 1 Jun 2026 assumed to apply too) times the role factors. Burden 1.25 is an assumption, not a sourced figure: the archipelago has its own social-security fund (CPS) and no LODEOM exemption, and its rates were not checked.",
    sources: [
      { label: "Prefecture: SMIC 1 Jan 2026 and the territories where it applies", url: "https://www.prefectures-regions.gouv.fr/normandie/Actualites/Revalorisation-annuelle-du-SMIC-au-1er-janvier-2026" },
      { label: "info.gouv.fr: SMIC raised on 1 June 2026", url: "https://www.info.gouv.fr/actualite/le-smic-revalorise-le-1er-juin-2026" },
    ],
    year: 2026,
  },
  {
    country: "GL",
    currency: "dkk",
    hourly: { receptionist: 129.83, lead_responder: 139.82, appointment_setter: 119.84, review_coordinator: 129.83, web_designer: 299.61, sales_trainer: 299.61, media_buyer: 299.61 },
    burden: 1.1,
    basis: "estimate",
    method: "Greenland has no statutory minimum wage; the proxy is DKK 99.87/hour, the first 2026 hourly rate in the SIK-Royal Greenland collective agreement (SIK unskilled pay sits near DKK 100/hour), times the role factors. Burden 1.10 is an estimate: the employer's share of the 10% mandatory pension saving (2026), with no employer payroll tax found.",
    sources: [
      { label: "SIK: collective agreement with Royal Greenland 2026-2028", url: "https://sik.gl/wp-content/uploads/2025/12/SIK-GB-2026.pdf" },
      { label: "KNR: SIK agreement, unskilled pay around DKK 100/hour", url: "https://knr.gl/da/nyheder/sik-fagl%C3%A6rte-f%C3%A5r-bedre-vilk%C3%A5r" },
      { label: "Naalakkersuisut: bill notes on mandatory pension saving (10% in 2026)", url: "https://naalakkersuisut.gl/-/media/horinger/2025/09/1909_pension/em2025-12_bemrkninger_ndring-af-inatsisartutlov-om-obligatorisk-pensionsordning_dk.docx" },
      { label: "wage.is: Greenland has no statutory minimum wage", url: "https://wage.is/greenland/" },
    ],
    year: 2026,
  },
];

/** Approximate US dollars per one unit of each currency. */
export const USD_PER_UNIT: Record<string, number> = {
  usd: 1,
  cad: 0.7014, // Bank of Canada, CAD 1.4257 per USD (13 Nov 2026)
  mxn: 0.05415, // Banxico FIX, MXN 18.4677 per USD (17 Nov 2026)
  gtq: 0.1309, // GTQ 7.6408 per USD (4 Nov 2026)
  bzd: 0.5, // peg, BZD 2 per USD
  hnl: 0.03704, // BCH reference, HNL 26.9340 buy / 27.0687 sell (12 Nov 2026)
  nio: 0.0273, // BCN fixed rate, NIO 36.6243 per USD (no crawl since Jan 2024)
  crc: 0.00225, // MONEX average, CRC 444.45 per USD (19 Nov 2026)
  cup: 0.001081, // informal market (elTOQUE), CUP 925 per USD (17 Nov 2026); official state rate is 24
  jmd: 0.006276, // BOJ trading, JMD 159.35 per USD (19 Nov 2026)
  htg: 0.007653, // BRH reference, HTG 130.66 per USD (21 Oct 2026)
  dop: 0.01662, // BCRD reference, DOP 60.01 buy / 60.34 sell (17 Nov 2026)
  bsd: 1, // peg 1:1
  bbd: 0.5, // peg, BBD 2 per USD
  ttd: 0.1474, // CBTT, TTD 6.7720 buy / 6.7989 sell (Sep 2026)
  xcd: 0.37037, // peg, XCD 2.70 per USD
  kyd: 1.2, // peg, USD 1.20 per KYD
  bmd: 1, // peg 1:1
  awg: 0.5587, // peg, AWG 1.79 per USD
  xcg: 0.5587, // peg, XCG 1.79 per USD
  eur: 1.1127, // ECB reference rate (11 Nov 2026)
  dkk: 0.1489, // ECB: EUR 1 = DKK 7.4755 (11 Nov 2026); DKK is pegged to the euro
};
export const FX_DATE = "2026-11-19";
export const FX_SOURCES: WageSource[] = [
  { label: "Bank of Canada: daily exchange rates", url: "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/" },
  { label: "Banxico: FIX exchange rate", url: "https://www.banxico.org.mx/tipcamb/tipCamMIAction.do?idioma=sp" },
  { label: "Azteca Jalisco: FIX of 17 Nov 2026 (18.4677)", url: "https://www.aztecajalisco.com/noticias-jalisco-local/subio-o-bajo-el-dolar-este-es-su-precio-en-mexico-y-jalisco-hoy-miercoles-18-de-noviembre/" },
  { label: "Banguat: exchange rate", url: "https://www.banguat.gob.gt/es/page/tipo-de-cambio" },
  { label: "AllRatesToday: Banguat reference rate", url: "https://allratestoday.com/es/central-bank-rates-api/banguat/" },
  { label: "El Heraldo: BCH rate of 12 Nov 2026", url: "https://www.elheraldo.hn/economia/precio-dolar-honduras-para-hoy-jueves-12-noviembre-CG32616411" },
  { label: "Banco Central de Nicaragua", url: "https://www.bcn.gob.ni/" },
  { label: "El Observador: MONEX rate (BCCR data)", url: "https://observador.cr/nuevo-minimo-historico-tipo-de-cambio-del-dolar-cae-a-44485-en-monex/" },
  { label: "Directorio Cubano: elTOQUE informal rates, November 2026", url: "https://www.directoriocubano.info/?p=158205" },
  { label: "Jamaica Observer: forex, 19 Nov 2026", url: "https://www.jamaicaobserver.com/2026/11/19/forex-159-35-one-us-dollar-20261119-2109-224234/" },
  { label: "Rio Times: BRH reference rate, 21 Oct 2026", url: "https://www.riotimesonline.com/haiti-economy-key-players-2026/" },
  { label: "Revista Mercado: BCRD rate of 17 Nov 2026", url: "https://revistamercado.do/money-invest/daily-news/precio-del-dolar-hoy-18-de-noviembre-de-2026-rd/" },
  { label: "Central Bank of Trinidad and Tobago", url: "https://www.central-bank.org.tt/" },
  { label: "Banca d'Italia: ECB reference rates, 11 Nov 2026", url: "https://www.bancaditalia.it/compiti/operazioni-cambi/cambio/cambi_rif_20261111" },
  { label: "Central Bank of Belize (BZD peg)", url: "https://www.centralbank.org.bz/" },
  { label: "Central Bank of The Bahamas (BSD peg)", url: "https://www.centralbankbahamas.com/" },
  { label: "Central Bank of Barbados (BBD peg)", url: "https://www.centralbank.org.bb/" },
  { label: "Eastern Caribbean Central Bank (XCD peg)", url: "https://www.eccb-centralbank.org/" },
  { label: "Cayman Islands Monetary Authority (KYD peg)", url: "https://www.cima.ky/" },
  { label: "Bermuda Monetary Authority (BMD peg)", url: "https://www.bma.bm/" },
  { label: "Centrale Bank van Aruba (AWG peg)", url: "https://www.cbaruba.org/" },
  { label: "Central Bank of Curacao and Sint Maarten (XCG peg)", url: "https://www.centralbank.cw/" },
];
