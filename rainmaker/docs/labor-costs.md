# Labor costs: what a person doing each job costs, by country

Each of the seven services replaces a job a local business would otherwise pay someone to do. The agency prices each service at or below what that person would cost in the client's country. This page shows the wage used for each job in each of the 39 countries and territories Rainmaker covers, where each number comes from, and how much to trust it.

The numbers live in `src/lib/labor-data.ts`. They were checked on 22 November 2026. Wages change every year (most minimum wages change in January), so re-check before you quote a client.

## The seven jobs and what they're compared with

| Service role | What the person does | United States (SOC) | Canada (NOC 2021) | Mexico (SINCO, used with ENOE) |
|---|---|---|---|---|
| `receptionist` | Answers the phone at the front desk | 43-4171 Receptionists and Information Clerks | 14101 Receptionists | 321 Receptionists, information workers and telephonists |
| `lead_responder` | Replies to web enquiries (customer service, inside sales) | 43-4051 Customer Service Representatives | 64409 Other customer and information services representatives | 321 (includes 3212, call-centre information workers) |
| `appointment_setter` | Calls past customers to book them again | 41-9041 Telemarketers | 65109 Other sales related occupations (telemarketers) | 4213 Telephone salespeople |
| `review_coordinator` | Asks customers for reviews and referrals and follows up | 43-9061 Office Clerks, General | 14100 General office support workers | 2511 Administrative and marketing assistants |
| `web_designer` | Builds and looks after a small-business website | 15-1255 Web and Digital Interface Designers | 21233 Web designers | 2271 Software and multimedia developers |
| `sales_trainer` | Trains and reviews sales staff | 13-1151 Training and Development Specialists | 41210 College and other vocational instructors (Job Bank's "company trainer") | 1511 Coordinators in administration, HR and marketing |
| `media_buyer` | Runs paid ads | 13-1161 Market Research Analysts and Marketing Specialists | 11202 Professional occupations in advertising, marketing and public relations | 2112 Marketing, advertising and communications specialists |

For the review coordinator, "Office Clerks, General" was chosen because the job is routine office follow-up, not sales or marketing.

## How the numbers were built

### Surveys: United States, Canada, Mexico

- **United States**: national median hourly wage from the BLS Occupational Employment and Wage Statistics survey, May 2025 (published May 2026).
- **Canada**: national median hourly wage from Job Bank, last updated 19 November 2025 from Labour Force Survey data for 2023–2024. Job Bank had not posted a 2026 update when this was checked.
- **Mexico**: average monthly pay by occupation from INEGI's ENOE household survey (first quarter of 2026, shown on DataMéxico), divided by 208 hours (the legal 48-hour week). ENOE counts part-time and informal workers, so its averages for office jobs are *below* what a full-time formal employee must legally be paid. Where that happened, the 2026 general minimum wage was used instead: MXN 315.04 a day × 30.4 days ÷ 208 hours = **MXN 46.04 an hour** (the daily wage also pays the weekly rest day). That floor applies to the receptionist, lead responder, appointment setter and review coordinator. For the sales trainer, ENOE's instructor groups (2713 and 2715) also average below the full-time minimum, so the coordinator group 1511 was used instead.
  - In the northern border zone (Zona Libre de la Frontera Norte) the 2026 minimum is MXN 440.87 a day, or **MXN 64.43 an hour**. Use that floor for clients there.

### Estimates: everywhere else

Almost none of the other countries publish wages by occupation. For them:

1. Start from the hourly statutory minimum wage in force in November 2026.
2. Where the minimum is set per month, divide by the legal working hours: 173.33 a month for a 40-hour week, 190.67 for 44 hours, 208 for 48 hours. Where it's set per day, divide by the hours in the legal day (Haiti: 8).
3. Multiply by a role factor:

| Role | Factor |
|---|--:|
| Receptionist | 1.3 |
| Lead responder | 1.4 |
| Appointment setter | 1.2 |
| Review coordinator | 1.3 |
| Web designer | 3.0 |
| Sales trainer | 3.0 |
| Media buyer | 3.0 |

These factors are assumptions, not measurements: they say an office worker typically earns a little above the minimum and a skilled marketing or web person earns about three times it.

Where a country has several minimums, the one that fits a typical small local business was used:

- **By business size** (Honduras, Dominican Republic, Panama): the smallest-business rate.
- **By sector** (El Salvador, Nicaragua, Haiti, Honduras, Panama): commerce and services.
- **By region** (Guatemala, Panama): the capital region.
- **By occupation only, with no general minimum** (Grenada, St Vincent and the Grenadines): the clerical or office-clerk rate.
- **No minimum at all** (Greenland): the lowest 2026 hourly rate in a union (SIK) collective agreement.

Guatemala also adds the mandatory Q250 monthly incentive bonus to the base, because every employee must be paid it.

### Burden: what an employer pays on top of the wage

The burden is one multiplier per country. It covers employer payroll taxes and social security, mandatory bonuses (13th and 14th month, aguinaldo, Bono 14, year-end bonus), vacation premiums, Canada's 4% vacation pay, and work-injury insurance where it's mandatory and its size is known.

It leaves out:

- paid days off that are already inside a monthly salary
- benefits the law doesn't require (US health insurance, for example)
- recruiting, training, equipment, desk space and management time
- severance savings

Each country's derivation is in its `method` line in the data file and in the notes below the tables.

### Turning an hourly wage into a monthly cost

monthly cost = hourly wage × full-time hours a month × burden

Use the country's legal week for the hours: 173 for 40 hours, 191 for 44 and 208 for 48. For example:

- A US receptionist: $18.27 × 173.33 × 1.10 = about **$3,480 a month**.
- A Mexican receptionist: MXN 46.04 × 208 × 1.33 = about **MXN 12,740 a month** (about $690).

## Wages by country

Hourly wage in local currency, before the burden. "survey" means role-level wage data; "estimate" means minimum wage × role factor.

### North America

| Country | Currency | Receptionist | Lead responder | Appointment setter | Review coordinator | Web designer | Sales trainer | Media buyer | Burden | Basis |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| Canada | CAD | 21.00 | 22.00 | 19.00 | 23.99 | 33.65 | 45.00 | 35.58 | 1.13 | survey |
| United States | USD | 18.27 | 21.53 | 17.04 | 21.64 | 50.00 | 33.31 | 37.87 | 1.10 | survey |
| Mexico | MXN | 46.04 | 46.04 | 46.04 | 46.04 | 52.88 | 58.17 | 62.50 | 1.33 | survey |
| Greenland | DKK | 129.83 | 139.82 | 119.84 | 129.83 | 299.61 | 299.61 | 299.61 | 1.10 | estimate |
| Saint-Pierre-et-Miquelon | EUR | 16.00 | 17.23 | 14.77 | 16.00 | 36.93 | 36.93 | 36.93 | 1.25 | estimate |

- **Canada**: Job Bank medians for the NOC codes above. Burden 1.13 = CPP 5.95% + EI 2.28% (2026 employer rates) + 4% vacation pay + about 1% workers' compensation. Quebec employers pay QPP, QPIP and a lower EI rate instead, which comes to about the same.
- **United States**: OEWS May 2025 medians. Burden 1.10 = BLS's June 2026 count of legally required benefits in private industry (Social Security, Medicare, federal and state unemployment insurance, workers' compensation): $3.40 an hour on $32.82 of wages. Health insurance is not required by law, so it isn't counted.
- **Mexico**: ENOE averages, with the minimum-wage floor described above. Burden 1.33 = IMSS employer quotas (about 18% of pay near the minimum, including the fixed health quota), INFONAVIT 5%, state payroll tax (about 3%; 2% to 4% depending on the state), a 15-day aguinaldo (4.1%) and the 25% vacation premium (0.8%). Payroll calculators put a minimum-wage worker in Mexico City at about MXN 12,758 a month against a MXN 9,577 wage, which is 1.33.
- **Greenland**: there is no statutory minimum wage. The base is DKK 99.87 an hour, the first 2026 rate in the SIK–Royal Greenland collective agreement; SIK's unskilled rates sit near DKK 100. Burden 1.10 is an estimate: the employer's share of the 10% mandatory pension saving in 2026. No employer payroll tax was found.
- **Saint-Pierre-et-Miquelon**: French SMIC (see Guadeloupe below). Burden 1.25 is an assumption, not a sourced figure. The archipelago has its own social-security fund (CPS) and no LODEOM exemption, and its rates were not checked.

### Central America

| Country | Currency | Receptionist | Lead responder | Appointment setter | Review coordinator | Web designer | Sales trainer | Media buyer | Burden | Basis |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| Guatemala | GTQ | 28.99 | 31.22 | 26.76 | 28.99 | 66.91 | 66.91 | 66.91 | 1.29 | estimate |
| Belize | BZD | 6.50 | 7.00 | 6.00 | 6.50 | 15.00 | 15.00 | 15.00 | 1.06 | estimate |
| El Salvador | USD | 2.79 | 3.00 | 2.57 | 2.79 | 6.43 | 6.43 | 6.43 | 1.22 | estimate |
| Honduras | HNL | 90.63 | 97.60 | 83.66 | 90.63 | 209.14 | 209.14 | 209.14 | 1.26 | estimate |
| Nicaragua | NIO | 70.94 | 76.39 | 65.48 | 70.94 | 163.70 | 163.70 | 163.70 | 1.32 | estimate |
| Costa Rica | CRC | 2,331.83 | 2,511.20 | 2,152.46 | 2,331.83 | 5,381.14 | 5,381.14 | 5,381.14 | 1.36 | estimate |
| Panama | USD | 3.08 | 3.32 | 2.84 | 3.08 | 7.11 | 7.11 | 7.11 | 1.25 | estimate |

Each line gives the base minimum the role factors are applied to, then the burden.

- **Guatemala**: Q22.30 an hour = the 2026 non-farm minimum for the department of Guatemala (Q4,002.28 a month, Acuerdo Gubernativo 256-2025) plus the Q250 incentive bonus, over 190.67 hours. The rest of the country is about 5% lower (Q3,816.90). Burden: IGSS 10.67% + IRTRA 1% + INTECAP 1% + aguinaldo and Bono 14 (a month's pay each).
- **Belize**: BZ$5.00 an hour, in force since January 2023. A rise to BZ$6.00 has been announced but had no date in 2026. Burden: the employer's Social Security share, 5.5% of insurable pay at the top band and a little more at low pay.
- **El Salvador**: US$2.14 an hour = the commerce and services minimum of $408.80 a month (from June 2025; no 2026 change) over 190.67 hours. Burden: ISSS 7.5% + AFP 8.75% + a 15-day aguinaldo + a 30% premium on 15 vacation days. INSAFORP (1%) applies only with 10 or more staff, so it's left out. One payroll guide gives the AFP employer rate as 7.75%, which would make the burden 1.21.
- **Honduras**: L69.71 an hour = the 2026 minimum for commerce in firms with 1–10 workers (L13,292.06 a month, Acuerdo SETRASS 233-2026) over 190.67 hours. The official tables show L55.38 an hour, but they divide by 30 days × 8 hours. Burden: IHSS about 7%, RAP 1.5%, INFOP 1%, plus the 13th and 14th month salaries.
- **Nicaragua**: C$54.57 an hour = the commerce, restaurants and hotels minimum of C$11,350.08 a month (from March 2026) over 208 hours. Burden: INSS 21.5% (employers with fewer than 50 staff) + INATEC 2% + the 13th month.
- **Costa Rica**: ₡1,793.71 an hour = the 2026 minimum for a generic unskilled worker (₡373,092.42 a month, Decreto 45303-MTSS) over 208 hours. Burden: CCSS employer charges 26.83% (2026) + aguinaldo 8.33% + about 1% for the mandatory INS work-risk policy.
- **Panama**: B/.2.37 an hour = the Region 1 retail minimum for small companies (Decreto Ejecutivo 13, from 16 January 2026). Large companies pay B/.3.02. Burden: CSS 13.25% (April 2025 to February 2027, rising after that) + 1.5% educational insurance + about 1% work-risk + the 13th month and its 10.75% CSS charge.

### Caribbean and Bermuda

| Country | Currency | Receptionist | Lead responder | Appointment setter | Review coordinator | Web designer | Sales trainer | Media buyer | Burden | Basis |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| Cuba | CUP | 21.89 | 23.58 | 20.21 | 21.89 | 50.52 | 50.52 | 50.52 | 1.19 | estimate |
| Jamaica | JMD | 552.50 | 595.00 | 510.00 | 552.50 | 1,275.00 | 1,275.00 | 1,275.00 | 1.13 | estimate |
| Haiti | HTG | 123.50 | 133.00 | 114.00 | 123.50 | 285.00 | 285.00 | 285.00 | 1.17 | estimate |
| Dominican Republic | DOP | 115.86 | 124.78 | 106.95 | 115.86 | 267.38 | 267.38 | 267.38 | 1.25 | estimate |
| Bahamas | BSD | 8.45 | 9.10 | 7.80 | 8.45 | 19.50 | 19.50 | 19.50 | 1.07 | estimate |
| Barbados | BBD | 13.92 | 14.99 | 12.85 | 13.92 | 32.13 | 32.13 | 32.13 | 1.13 | estimate |
| Trinidad and Tobago | TTD | 26.65 | 28.70 | 24.60 | 26.65 | 61.50 | 61.50 | 61.50 | 1.11 | estimate |
| Antigua and Barbuda | XCD | 14.95 | 16.10 | 13.80 | 14.95 | 34.50 | 34.50 | 34.50 | 1.13 | estimate |
| Dominica | XCD | 11.70 | 12.60 | 10.80 | 11.70 | 27.00 | 27.00 | 27.00 | 1.08 | estimate |
| Grenada | XCD | 9.00 | 9.69 | 8.31 | 9.00 | 20.77 | 20.77 | 20.77 | 1.07 | estimate |
| St Kitts and Nevis | XCD | 16.25 | 17.50 | 15.00 | 16.25 | 37.50 | 37.50 | 37.50 | 1.10 | estimate |
| Saint Lucia | XCD | 8.48 | 9.13 | 7.82 | 8.48 | 19.56 | 19.56 | 19.56 | 1.05 | estimate |
| St Vincent and the Grenadines | XCD | 9.38 | 10.10 | 8.65 | 9.38 | 21.63 | 21.63 | 21.63 | 1.08 | estimate |
| Cayman Islands | KYD | 11.38 | 12.25 | 10.50 | 11.38 | 26.25 | 26.25 | 26.25 | 1.12 | estimate |
| Bermuda | BMD | 22.27 | 23.98 | 20.56 | 22.27 | 51.39 | 51.39 | 51.39 | 1.20 | estimate |
| Turks and Caicos | USD | 10.40 | 11.20 | 9.60 | 10.40 | 24.00 | 24.00 | 24.00 | 1.10 | estimate |
| British Virgin Islands | USD | 9.43 | 10.15 | 8.70 | 9.43 | 21.75 | 21.75 | 21.75 | 1.08 | estimate |
| Anguilla | XCD | 21.06 | 22.68 | 19.44 | 21.06 | 48.60 | 48.60 | 48.60 | 1.09 | estimate |
| Montserrat | XCD | 16.25 | 17.50 | 15.00 | 16.25 | 37.50 | 37.50 | 37.50 | 1.08 | estimate |
| Aruba | AWG | 15.05 | 16.21 | 13.90 | 15.05 | 34.74 | 34.74 | 34.74 | 1.23 | estimate |
| Curaçao | XCG | 15.51 | 16.70 | 14.32 | 15.51 | 35.79 | 35.79 | 35.79 | 1.21 | estimate |
| Sint Maarten | XCG | 14.21 | 15.30 | 13.12 | 14.21 | 32.79 | 32.79 | 32.79 | 1.16 | estimate |
| Caribbean Netherlands (Bonaire, Statia, Saba) | USD | 13.90 | 14.97 | 12.83 | 13.90 | 32.07 | 32.07 | 32.07 | 1.10 | estimate |
| Guadeloupe | EUR | 16.00 | 17.23 | 14.77 | 16.00 | 36.93 | 36.93 | 36.93 | 1.15 | estimate |
| Martinique | EUR | 16.00 | 17.23 | 14.77 | 16.00 | 36.93 | 36.93 | 36.93 | 1.15 | estimate |
| Saint-Barthélemy | EUR | 16.00 | 17.23 | 14.77 | 16.00 | 36.93 | 36.93 | 36.93 | 1.15 | estimate |
| Saint-Martin | EUR | 16.00 | 17.23 | 14.77 | 16.00 | 36.93 | 36.93 | 36.93 | 1.15 | estimate |

Each line gives the base minimum, then the burden.

- **Cuba**: 16.84 CUP an hour (3,210 CUP a month from 1 July 2026, Resolución 14/2026). Private businesses (mipymes) usually pay well above the state minimum, so treat this as a very low floor. Burden: 14% social-security contribution + 5% tax on use of the labour force.
- **Jamaica**: J$425 an hour (J$17,000 per 40-hour week from 1 July 2026). Burden: employer NIS 3% + NHT 3% + Education Tax 3.5% + HEART/NSTA 3%.
- **Haiti**: 95 HTG an hour = 760 HTG per 8-hour day for segment C (retail, restaurants), from 6 May 2026. Banks and insurers (segment A) pay 1,000 HTG a day. Burden: ONA pension 6% + OFATMA about 3% + a year-end bonus of a month's pay.
- **Dominican Republic**: RD$89.13 an hour = the non-sectorized minimum for micro-businesses (RD$16,993.20 a month from 1 February 2026) over 190.67 hours. Small businesses pay RD$18,421.20, medium RD$27,489.60 and large RD$29,988. Burden: AFP 7.10% + SFS 7.09% + work-risk insurance about 1.1% + INFOTEP 1% + the Christmas salary (13th month).
- **Bahamas**: B$6.50 an hour (B$260 a week since January 2023; no 2026 rise found). Burden: NIB employer 6.65% (from July 2024). A further NIB change was scheduled for July 2026 but its rate wasn't found.
- **Barbados**: BBD 10.71 an hour (2% indexation from 21 January 2026). Burden: employer NIS 12.75% + the 0.25% Resilience and Regeneration Fund levy.
- **Trinidad and Tobago**: TT$20.50 an hour (since January 2024). Burden: employer NIS 10.8% (two-thirds of the 16.2% rate from 5 January 2026; another rise is due in January 2027).
- **Antigua and Barbuda**: EC$11.50 an hour (from 1 April 2026, the first step towards EC$13.00). Burden: Social Security 9% + Medical Benefits 3.5%.
- **Dominica**: EC$9.00 an hour (from 1 December 2025). Cashiers and receptionists have their own minimum of EC$9.42. Burden: employer Social Security 8% (2026).
- **Grenada**: EC$6.92 an hour = the clerical, cashier and receptionist minimum of EC$1,200 a month (SRO 42 of 2023) over 173.33 hours. Call-centre staff have an EC$8.50 hourly minimum, slightly above the appointment-setter estimate. Burden: employer NIS 7.25% (2026).
- **St Kitts and Nevis**: EC$12.50 an hour (from 1 July 2025). Burden: Social Security 5% + employment injury 1% + severance fund 1% + Housing and Social Development Levy 3%. The levy and severance parts come from one payroll guide.
- **Saint Lucia**: EC$6.52 an hour (from 1 October 2024). Burden: employer NIC 5%.
- **St Vincent and the Grenadines**: EC$7.21 an hour = the office-clerk minimum of EC$1,250 a month (from 1 March 2024) over 173.33 hours. There is no national minimum. Burden: employer NIS 7.5% (2026).
- **Cayman Islands**: CI$8.75 an hour (from 1 January 2026). Burden: 5% employer pension + the employer's share (usually half) of the mandatory standard health insurance, taken as about 7% of a low wage. No premium table was found.
- **Bermuda**: BMD 17.13 an hour (from 1 September 2025). Burden 1.20 is rough: employer payroll tax (1% to about 7% depending on the employer class), social insurance of BMD 39.25 a week, 5% pension, and at least half a health-insurance premium (amount not found).
- **Turks and Caicos**: US$8.00 an hour (since April 2023; from secondary sources). Burden: NIB 6.5% + National Health Insurance Plan 3%.
- **British Virgin Islands**: US$7.25 an hour (from 1 July 2025). Burden: Social Security 4.5% + National Health Insurance 3.75%.
- **Anguilla**: EC$16.20 (US$6.00) an hour, approved by the Executive Council; the gazetted start date wasn't confirmed. Burden: Social Security 5.75% (2026) + 3% stabilisation levy.
- **Montserrat**: EC$12.50 an hour (Minimum Wage Order 2025, from 1 April 2026). Burden: employer Social Security of about 8%, the 2026 step of the 2022 schedule (not confirmed).
- **Aruba**: AWG 11.58 an hour (new hourly minimum from 1 January 2026). Burden: AOV/AWW 10.5% + AZV 8.9% + sickness insurance 2.65% + accident insurance about 0.5%.
- **Curaçao**: XCG 11.93 an hour (from 1 January 2026). Burden: AOV 9% + AWW 0.5% + BVZ 9.3% + ZV 1.9% + accident insurance about 0.5%.
- **Sint Maarten**: XCG 10.93 an hour (from 1 January 2026). Burden: AOV 7% + AWW 0.5% + ZV 8.3% + accident insurance about 0.5%, taken from older SZV tables (2023 and earlier).
- **Caribbean Netherlands**: US$10.69 an hour on Bonaire (Sint Eustatius $10.61, Saba $10.66; from 1 January 2026). Burden: employer health insurance 9.3% + sickness 0.7% + accident 0.2% + cessantia 0.1% (the 2025 rates; the 2026 ones weren't found).
- **Guadeloupe, Martinique, Saint-Barthélemy, Saint-Martin**: the French SMIC of €12.31 an hour (raised from €12.02 on 1 June 2026) applies.
  - Burden 1.15 is a blend, not a single legal rate. Near the SMIC, the LODEOM exemption and France's general reduction remove most employer contributions, so the four lower-paid roles cost about 1.05–1.10. At three times the SMIC (web designer, sales trainer, media buyer), contributions are close to full, about 1.40 or more.
  - In Saint-Barthélemy, real pay is usually far above the SMIC.

## Exchange rates

US dollars per one unit of each currency (`USD_PER_UNIT`), mid-November 2026 where available.

| Currency | USD per unit | Rate used | Date | Source |
|---|--:|---|---|---|
| USD | 1 | — | — | — |
| CAD | 0.7014 | 1.4257 CAD per USD | 13 Nov 2026 | Bank of Canada (as reported) |
| MXN | 0.05415 | 18.4677 MXN per USD (FIX) | 17 Nov 2026 | Banxico |
| GTQ | 0.1309 | 7.6408 GTQ per USD | 4 Nov 2026 | Banguat reference rate (third-party feed) |
| BZD | 0.5 | Peg, 2 BZD per USD | — | Central Bank of Belize |
| HNL | 0.03704 | 26.9340 buy / 27.0687 sell | 12 Nov 2026 | Banco Central de Honduras |
| NIO | 0.0273 | 36.6243 NIO per USD, fixed since January 2024 | — | Banco Central de Nicaragua |
| CRC | 0.00225 | 444.45 CRC per USD (MONEX) | 19 Nov 2026 | BCCR market data |
| CUP | 0.001081 | 925 CUP per USD, informal market (elTOQUE) | 17 Nov 2026 | elTOQUE via Directorio Cubano |
| JMD | 0.006276 | 159.35 JMD per USD | 19 Nov 2026 | Bank of Jamaica trading |
| HTG | 0.007653 | 130.66 HTG per USD | 21 Oct 2026 | BRH reference rate |
| DOP | 0.01662 | 60.01 buy / 60.34 sell | 17 Nov 2026 | Banco Central de la República Dominicana |
| BSD | 1 | Peg 1:1 | — | Central Bank of The Bahamas |
| BBD | 0.5 | Peg, 2 BBD per USD | — | Central Bank of Barbados |
| TTD | 0.1474 | 6.7720 buy / 6.7989 sell | Sep 2026 | Central Bank of Trinidad and Tobago |
| XCD | 0.37037 | Peg, 2.70 XCD per USD | — | Eastern Caribbean Central Bank |
| KYD | 1.2 | Peg, USD 1.20 per KYD | — | Cayman Islands Monetary Authority |
| BMD | 1 | Peg 1:1 | — | Bermuda Monetary Authority |
| AWG | 0.5587 | Peg, 1.79 AWG per USD | — | Centrale Bank van Aruba |
| XCG | 0.5587 | Peg, 1.79 XCG per USD | — | Central Bank of Curaçao and Sint Maarten |
| EUR | 1.1127 | ECB reference rate | 11 Nov 2026 | ECB (via Banca d'Italia) |
| DKK | 0.1489 | EUR 1 = DKK 7.4755 (DKK is pegged to the euro) | 11 Nov 2026 | ECB (via Banca d'Italia) |

**Cuba**: the informal rate was used because it is what pesos are actually worth to a business. The official rate of 24 CUP per dollar is used only in state accounts, and it would make Cuban wages look about 38 times higher in dollars.

## Caveats

- **National medians hide big local differences.** In Canada, Job Bank's receptionist median is $24.00 in British Columbia, $20.50 in Ontario and $20.00 in Quebec. In the US, big-city wages run well above the national median and small towns well below it. A client in Toronto, New York or Mexico City pays more than these numbers.
- **Estimates are floors.** They start from the legal minimum. Real pay for skilled roles (web design, sales training, media buying) is often more than three times the minimum, especially on small islands that hire skilled people from abroad (Cayman, Bermuda, BVI, Saint-Barthélemy). Pricing below a floor is safe; pricing above a floor is a claim you can't back with this data.
- **Role factors are assumptions.** They're the same for every estimate country. They're consistent, but they don't reflect any one country's market.
- **Mexico's office roles sit at the legal minimum** because ENOE's averages fall below it. Formal job ads in big cities often offer a little more (Indeed México's average for receptionists was about MXN 9,354 a month in mid-2026, against a MXN 9,577 minimum). In the northern border zone the floor is MXN 64.43 an hour.
- **Cuba**: the numbers are close to meaningless in dollar terms. The state minimum is about $3.50 a month at the informal rate, private pay is far higher, and card or PayPal payments may not work at all.
- **The burden is the legal minimum cost, not the full cost.** Health insurance (US), benefits, hiring, training, equipment, space and management time are extra, so a real employee costs more than hourly × hours × burden.
- **Less certain numbers:**
  - Greenland's base rate and burden
  - Saint-Pierre-et-Miquelon's burden
  - The health-insurance part of the Cayman and Bermuda burdens
  - Panama's small-company rate (taken from secondary tables of the decree)
  - Anguilla's start date
  - Turks and Caicos (secondary sources only)
  - Montserrat's Social Security rate
  - Sint Maarten's and the Caribbean Netherlands' contribution rates (from earlier years)
  - Costa Rica's minimum, which is the first-half-2026 figure (no second-half decree was found)
- **How this was checked.** Most figures were read from search-engine excerpts of the pages listed below, not by opening each page, because direct access to most sites was blocked during this check. Only the BLS national table was read directly. Before you quote a number to a client, open its source and confirm it.
- **Rates change.** Most countries adjust minimum wages every January, and several have already announced 2027 steps: Costa Rica +1.70%, Honduras +6% for small firms, Antigua and Barbuda towards EC$13.00, and Trinidad and Tobago's NIS. Re-check every year.

## Sources

### United States
- [BLS OEWS May 2025, Table 1 (national wages by occupation)](https://www.bls.gov/news.release/ocwage.t01.htm)
- [BLS OEWS 43-4171 Receptionists and Information Clerks](https://www.bls.gov/oes/current/oes434171.htm) · [OOH: Receptionists](https://www.bls.gov/ooh/office-and-administrative-support/receptionists.htm)
- [BLS OEWS 43-4051 Customer Service Representatives](https://www.bls.gov/oes/current/oes434051.htm) · [OOH: Customer Service Representatives](https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm)
- [BLS OEWS 41-9041 Telemarketers](https://www.bls.gov/oes/current/oes419041.htm) · [O*NET national wages 41-9041 (BLS 2025)](https://www.onetonline.org/link/localwages/41-9041.00)
- [BLS OEWS 43-9061 Office Clerks, General](https://www.bls.gov/oes/current/oes439061.htm) · [OOH: General Office Clerks](https://www.bls.gov/ooh/office-and-administrative-support/general-office-clerks.htm)
- [BLS OEWS 15-1255 Web and Digital Interface Designers](https://www.bls.gov/oes/current/oes151255.htm) · [OOH: Web Developers and Digital Designers](https://www.bls.gov/ooh/computer-and-information-technology/web-developers.htm) · [O*NET national wages 15-1255 (BLS 2025)](https://www.onetonline.org/link/localwages/15-1255.00)
- [BLS OEWS 13-1151 Training and Development Specialists](https://www.bls.gov/oes/current/oes131151.htm) · [OOH: Training and Development Specialists](https://www.bls.gov/ooh/business-and-financial/training-and-development-specialists.htm)
- [BLS OEWS 13-1161 Market Research Analysts and Marketing Specialists](https://www.bls.gov/oes/current/oes131161.htm) · [OOH: Market Research Analysts](https://www.bls.gov/ooh/business-and-financial/market-research-analysts.htm)
- [BLS Employer Costs for Employee Compensation, June 2026, Table 1](https://www.bls.gov/news.release/ecec.t01.htm)

### Canada
- [Job Bank: Receptionist (NOC 14101)](https://www.jobbank.gc.ca/marketreport/wages-occupation/24391/ca)
- [Job Bank: Customer Service Agent (NOC 64409)](https://www.jobbank.gc.ca/marketreport/wages-occupation/15216/ca)
- [Job Bank: Telemarketer (NOC 65109)](https://www.jobbank.gc.ca/marketreport/wages-occupation/2886/ca)
- [Job Bank: Clerk, General Office (NOC 14100)](https://www.jobbank.gc.ca/marketreport/wages-occupation/12604/ca)
- [Job Bank: Web Designer (NOC 21233)](https://www.jobbank.gc.ca/marketreport/wages-occupation/17898/ca)
- [Job Bank: Company Trainer (NOC 41210)](https://www.jobbank.gc.ca/marketreport/summary-occupation/22879/ca)
- [Job Bank: Marketing Coordinator (NOC 11202)](https://www.jobbank.gc.ca/marketreport/wages-occupation/27114/ca)
- [Job Bank: wage methodology](https://www.jobbank.gc.ca/trend-analysis/search-wages/wage-methodology)
- [ESDC: 2026 EI premium rate](https://www.canada.ca/en/employment-social-development/news/2025/09/canada-employment-insurance-commission-sets-the-2026-employment-insurance-premium-rate.html)
- [Memorial University: 2026 payroll rates (CPP 5.95%, YMPE $74,600)](https://www.mun.ca/hr/media/production/memorial/administrative/human-resources/media-library/services/2026-tax-changes.pdf)

### Mexico
- DataMéxico (ENOE), 2026-Q1:
  - [Receptionists, information workers and telephonists (321)](https://www.economia.gob.mx/datamexico/es/profile/occupation/recepcionistas-trabajadores-que-brindan-informacion-y-telefonistas)
  - [Telephone salespeople (4213)](https://www.economia.gob.mx/datamexico/es/profile/occupation/vendedores-por-telefono)
  - [Administrative and marketing assistants (2511)](https://www.economia.gob.mx/datamexico/es/profile/occupation/auxiliares-en-administracion-mercadotecnia-comercializacion-y-comercio-exterior)
  - [Software and multimedia developers (2271)](https://www.economia.gob.mx/datamexico/es/profile/occupation/desarrolladores-y-analistas-de-software-y-multimedia)
  - [Coordinators in administration, HR and marketing (1511)](https://www.economia.gob.mx/datamexico/es/profile/occupation/coordinadores-y-jefes-de-area-en-administracion-recursos-humanos-y-mercadotecnia)
  - [Marketing and advertising specialists (2112)](https://www.economia.gob.mx/datamexico/es/profile/occupation/especialistas-y-consultores-en-mercadotecnia-publicidad-comunicacion-y-comercio-exterior)
  - [Instructors in commercial and administrative training (2713)](https://www.economia.gob.mx/datamexico/es/profile/occupation/instructores-en-estudios-y-capacitacion-comercial-y-administrativa)
- [CONASAMI](https://www.gob.mx/conasami) and [EY: 2026 minimum wages (DOF, 9 December 2025)](https://www.ey.com/es_mx/technical/tax/boletines-fiscales/incremento-salarios-minimos-2026)
- [Praxium: cost of a minimum-wage employee, 2026](https://praxiumconsultores.com/blog/costo-de-un-empleado-con-salario-minimo-2026-para-el-patron)

### Central America
- Guatemala:
  - [AGN: 2026 minimum wages](https://agn.gt/asi-quedan-los-montos-del-salario-minimo-para-el-2026/)
  - [EY: Guatemala minimum wage 2026](https://www.ey.com/es_ce/technical/tax/tax-alerts/guatemala-salario-minimo-2026)
  - [La Hora: real cost of a minimum-wage job, 2026](https://lahora.gt/lh-economia/hloarca/2026/01/03/cuanto-cuesta-realmente-a-una-empresa-en-guatemala-crear-una-plaza-con-salario-minimo-en-2026/)
- Belize:
  - [Government of Belize: $5.00 minimum wage](https://www.pressoffice.gov.bz/minimum-wage-increases-for-all-categories-of-workers/)
  - [WageIndicator: Belize](https://wageindicator.org/salary/minimum-wage/belize)
  - [Social Security Board: contribution schedule](https://www.socialsecurity.org.bz/wp-content/uploads/2021/12/Apr-2022_cont_ben_F.pdf)
- El Salvador:
  - [EY: El Salvador minimum wage 2026](https://www.ey.com/es_ce/technical/tax/tax-alerts/el-salvador-salario-minimo-2026)
  - [Decreto Ejecutivo, May 2025](https://www.jurisprudencia.gob.sv/DocumentosBoveda/D/2/2020-2029/2025/05/10A4DA.PDF)
  - [FiniquitoJusto: 2026 payroll deductions](https://finiquitojusto.com/?p=4011)
  - [PwC: El Salvador other taxes](https://taxsummaries.pwc.com/el-salvador/individual/other-taxes)
- Honduras:
  - [Acuerdo SETRASS 233-2026](https://www.tsc.gob.hn/web/leyes/Acuerdo-SETRASS-233-2026.pdf)
  - [Bloomberg Línea: 2026 table](https://www.bloomberglinea.com/latinoamerica/honduras/salario-minimo-2026-en-honduras-estos-son-los-nuevos-montos-por-actividad-economica/)
  - [Cazvid: hiring in Honduras 2026](https://cazvid.com/es/blog/como-contratar-personal-en-honduras-guia-legal)
  - [PwC: Honduras other taxes](https://taxsummaries.pwc.com/honduras/corporate/other-taxes)
- Nicaragua:
  - [WageIndicator: minimum wage from 1 March 2026](https://wageindicator.org/work/minimum-wage/updates/2026/minimum-wage-updated-in-nicaragua-from-01-march-2026-march-11-2026)
  - [Bloomberg Línea: 2026 minimum wages](https://www.bloomberglinea.com/2026/03/06/salario-minimo-en-nicaragua-2026-estos-son-los-nuevos-montos-tras-el-aumento-del-4/)
  - [Niural: hiring in Nicaragua](https://www.niural.com/blog/hiring-in-nicaragua-minimum-wage-and-employment-guide)
- Costa Rica:
  - [EY: Costa Rica minimum wage 2026](https://www.ey.com/es_ce/technical/tax/tax-alerts/costa-rica-salario-minimo-2026)
  - [WageIndicator: Costa Rica](https://wageindicator.org/es-cr/ai/trabajo-en-costa-rica/salario-minimo/)
  - [EY: employer charges from January 2026](https://www.ey.com/es_ce/technical/tax/tax-alerts/costa-rica-aumento-en-cuotas-obrero-patronales-aplicable-desde-enero-20261)
- Panama:
  - [La Prensa: 2026 minimum wage rates](https://www.prensa.com/economia/salario-minimo-2026-en-panama-estas-son-las-nuevas-tarifas-por-actividad-y-region/)
  - [Claviweb: Decreto Ejecutivo 13 table](https://claviweb.com/guias/salario-minimo-panama)
  - [MITRADEL minimum wage lookup](https://apps.mitradel.gob.pa/SalarioMinimo/)
  - [TVN: CSS employer contribution steps](https://www.tvn-2.com/nacionales/reformas-a-la-css-aumento-escalonado-cuota-patronal-caja-de-seguro-social_1_2182102.amp.html)

### Caribbean and Bermuda
- Cuba:
  - [Periódico Cubano: new minimum wage](https://www.periodicocubano.com/en-vigor-nuevo-salario-minimo-en-cuba-pero-los-trabajadores-deben-esperar-para-cobrarlo/?amp=1)
  - [CiberCuba: what the minimum wage buys](https://en.cibercuba.com/noticias/2026-06-20-u1-e208574-s27061-nid332827-podra-comprar-cuba-nuevo-salario-minimo-ni-carton)
  - [Periódico Cubano: the 17 taxes for 2026](https://www.periodicocubano.com/gaceta-oficial-publica-los-17-impuestos-que-se-cobraran-en-cuba-durante-el-2026/?amp=1)
- Jamaica:
  - [JIS: minimum wage moves to $17,000](https://jis.gov.jm/minimum-wage-moves-to-17000-on-july-1/)
  - [PwC: Jamaica other taxes](https://taxsummaries.pwc.com/jamaica/corporate/other-taxes)
- Haiti:
  - [HaitiLibre: 2026 minimum wages](https://www.haitilibre.com/en/news-47534-flash-new-minimum-wages-in-haiti-for-all-sectors-of-activity-official-2026.html)
  - [WageIndicator: Haiti](https://wageindicator.org/fr-ht/travail-en-haiti/salaire-minimum)
  - [Rivermate: Haiti benefits](https://www.rivermate.com/guides/haiti/benefits)
- Dominican Republic:
  - [Bloomberg Línea: 2025–2026 minimum wage](https://www.bloomberglinea.com/latinoamerica/republica-dominicana/salario-minimo-en-republica-dominicana-de-cuanto-es-el-20-de-aumento-en-2025-y-2026/)
  - [Presidencia: February 2026 increase](https://presidencia.gob.do/noticias/ministerio-de-trabajo-llama-empresarios-cumplir-con-el-pago-del-aumento-del-8-del-salario)
  - [Siempre al Día: payroll and TSS](https://siemprealdia.co/republica-dominicana/derecho-laboral/gestion-de-nominas-y-seguridad-social/)
- Bahamas:
  - [WageIndicator: Bahamas](https://wageindicator.org/en-bs/work-in-bahamas/minimum-wage/)
  - [NIB: contributions](https://www.nib-bahamas.com/Contributions)
- Barbados:
  - [WageIndicator: minimum wage from 21 January 2026](https://wageindicator.org/work/minimum-wage/updates/2026/minimum-wage-updated-in-barbados-from-21-january-2026-february-09-2026)
  - [NIS: rates and contributions](https://www.nis.gov.bb/rates-and-contributions/)
  - [Workzoom: NIS and PAYE guide 2026](https://www.workzoom.com/barbados/compliance/nis-paye/)
- Trinidad and Tobago:
  - [WageIndicator: Trinidad and Tobago](https://wageindicator.org/en-tt/work-in-trinidad-and-tobago/minimum-wage)
  - [PwC: other taxes](https://taxsummaries.pwc.com/trinidad-and-tobago/individual/other-taxes)
  - [Guardian: new NIS rates from 5 January](https://guardian.co.tt/business/new-nis-rates-start-jan-5-6.2.2475691.acc42f8424)
- Antigua and Barbuda:
  - [Antigua Newsroom: $11.50 from 1 April](https://antiguanewsroom.com/labour-department-confirms-11-50-minimum-wage-effective-april-1/)
  - [WageIndicator: April 2026 update](https://wageindicator.org/work/minimum-wage/updates/2026/minimum-wage-updated-in-antigua-and-barbuda-from-01-april-2026-april-07-2026)
  - [Teamed: tax and payroll](https://www.teamed.global/country-hiring-guides/antigua-and-barbuda/tax-and-payroll)
- Dominica:
  - [Government of Dominica: minimum wage from 1 December 2025](https://pressroomopm.gov.dm/government-of-dominica-announces-new-minimum-wage-structure-effective-december-1-2025/)
  - [Official Gazette: Minimum Wage Order 2025](https://printery.dominica.gov.dm/Gazettes/Details/5758)
  - [Deloitte: tax highlights 2026](https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-dominicahighlights-2026.pdf)
- Grenada:
  - [Minimum Wages Order 2023 (SRO 42 of 2023)](https://nowgrenada.com/wp-content/uploads/2023/12/S.R.O.-42-of-2023-Minimum-Wages-Order.pdf)
  - [Deloitte: tax highlights 2026](https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-grenadahighlights-2026.pdf)
  - [NIS Grenada](https://nisgrenada.org/)
- St Kitts and Nevis:
  - [WageIndicator: July 2025 update](https://wageindicator.org/ai/work/minimum-wage/updates/2025/minimum-wage-updated-in-st-kitts-and-nevis-from-01-july-2025-july-06-2025/)
  - [Deloitte: tax highlights 2026](https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-stkittsandnevishighlights-2026.pdf)
  - [Teamed: cost breakdown](https://www.teamed.global/country-hiring-guides/saint-kitts-and-nevis/cost-breakdown)
- Saint Lucia:
  - [Government of Saint Lucia: national minimum wage](https://www.govt.lc/news/implementation-of-the-national-minimum-wage)
  - [Deloitte: tax highlights 2026](https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-stluciahighlights-2026.pdf)
  - [PwC: other taxes](https://taxsummaries.pwc.com/saint-lucia/individual/other-taxes)
- St Vincent and the Grenadines:
  - [WageIndicator: offices of professionals](https://wageindicator.org/salary/minimum-wage/st-vincent-and-the-grenadines/39494-offices-of-professionals)
  - [One News: NIS increase from 1 January 2026](https://onenewsstvincent.com/2025/12/30/all-employers-and-employees-reminded-of-nis-increase-from-jan-1-2026/)
  - [NIS SVG: rates](https://www.nissvg.org/rates/)
- Cayman Islands:
  - [Cayman Islands Government: minimum wage from 1 January 2026](https://gov.ky/w/new-minimum-wage-effective-1-january-2026)
  - [PwC: other issues](https://taxsummaries.pwc.com/cayman-islands/individual/other-issues)
  - [CICBD: hiring employees](https://www.cicbd.gov.ky/hire-and-manage-employees)
- Bermuda:
  - [Government of Bermuda: $17.13 from 1 September 2025](https://www.gov.bm/news/public-reminder-minimum-wage-increase-take-effect-september-1-2025)
  - [PwC: other taxes](https://taxsummaries.pwc.com/bermuda/individual/other-taxes)
  - [Government of Bermuda: payroll tax](https://www.gov.bm/payroll-tax)
- Turks and Caicos:
  - [Chambers: Investing In 2026](https://gpg-pdf.chambers.com/investing-in-2026/640/)
  - [Rivermate: taxes](https://rivermate.com/guides/turks-and-caicos-islands/taxes)
- British Virgin Islands:
  - [Government of the Virgin Islands: new minimum wage](https://www.gov.vg/news/new-minimum-wage-take-effect-july-1)
  - [Harneys: BVI minimum wage](https://www.harneys.com/insights/new-bvi-national-minimum-wage-announced/)
  - [Global Expansion: employer costs](https://www.globalexpansion.com/countrypedia/british-virgin-islands)
- Anguilla:
  - [Executive Council paper on the national minimum wage](https://gov.ai/document/2024-04-09-071700_1196259153.pdf)
  - [Social Security Board: contributions](https://ssbai.com/contributions.php)
  - [Deloitte: tax highlights 2026](https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-anguillahighlights-2026.pdf)
- Montserrat:
  - [Minimum Wage Order 2025 (SRO 48 of 2025)](https://parliament.ms/wp-content/uploads/2026/04/SRO-No.-48-of-2025-Minimum-Wage-Order-2025.pdf)
  - [Social Security contributions regulations 2022](https://www.gov.ms/wp-content/uploads/2022/02/SRO-No-8-of-2022-Contributions-Amendment-Regulations.pdf)
- Aruba:
  - [Government of Aruba: hourly minimum wage from 1 January 2026](https://www.gobierno.aw/en/introduction-of-a-minimum-hourly-wage-effective-january-1-2026)
  - [Rivermate: employment cost calculator](https://www.rivermate.com/guides/aruba/employment-cost-calculator)
- Curaçao:
  - [Regeling indexering minimumloon 2026](https://gobiernu.cw/wp-content/uploads/2025/12/236.-MR-indexering-minimumloon-2026.pdf)
  - [Curaçao Chronicle: SVB 2026 premium rates](https://www.curacaochronicle.com/post/local/svb-publishes-pension-amounts-premium-rates-and-income-limits-for-2026)
  - [Orbitax: 2026 social security rates](https://orbitax.com/news/country/article/Curacao-Publishes-Social-Secur-60770)
- Sint Maarten:
  - [Government of Sint Maarten: minimum wage from 1 January 2026](https://www.sintmaartengov.org/news/Pages/Minister-Brug-Announces-Updated-Minimum-Hourly-Wage-Effective-January-1-2026.aspx)
  - [SZV 2023 premiums (via Celery Payroll)](https://www.celerypayroll.com/wp-content/uploads/2024/04/SZV-2023-AOV-AWW-Amounts-Wage-Limits-Web.pdf)
  - [Celery Payroll: social insurances in Sint Maarten](https://support.celerypayroll.com/en/support/solutions/articles/6000166062-what-social-insurances-are-applicable-in-sint-maarten-)
- Caribbean Netherlands:
  - [Rijksdienst Caribisch Nederland: minimum wage from 1 January 2026](https://english.rijksdienstcn.com/latest/news/2025/december/04/new-minimum-wage-child-benefit-and-social-security-benefit-amounts-in-the-caribbean-netherlands-as-of-1-january-2026)
  - [Belastingdienst Caribisch Nederland: notes to the 2025 tables](https://english.belastingdienst-cn.nl/binaries/belastingdienst-cn-en/documenten/leaflets/belastingdienst/lh/tabellen-en-rekenregels-2025/notes-2025/Toelichting_tabellen_1_1_2025.pdf)
- French territories (Guadeloupe, Martinique, Saint-Barthélemy, Saint-Martin, Saint-Pierre-et-Miquelon):
  - [info.gouv.fr: SMIC raised on 1 June 2026](https://www.info.gouv.fr/actualite/le-smic-revalorise-le-1er-juin-2026)
  - [Service-Public: minimum wage](https://www.service-public.gouv.fr/particuliers/actualites/A18916)
  - [Prefecture: SMIC on 1 January 2026 and where it applies](https://www.prefectures-regions.gouv.fr/normandie/Actualites/Revalorisation-annuelle-du-SMIC-au-1er-janvier-2026)
  - [LODEOM exemption: Guadeloupe and Martinique](https://les-aides.fr/aide/FTNP3w/urssaf/exoneration-cotisations-lodeom-entreprises-en-guadeloupe-guyane-martinique-reunion.html)
  - [LODEOM exemption: Saint-Barthélemy and Saint-Martin](https://les-aides.fr/aide/U2cv3w/urssaf/exoneration-cotisations-lodeom-entreprises-a-st-barthelemy-et-a-st-martin.html)
- Greenland:
  - [SIK: agreement with Royal Greenland 2026–2028](https://sik.gl/wp-content/uploads/2025/12/SIK-GB-2026.pdf)
  - [KNR: SIK unskilled pay](https://knr.gl/da/nyheder/sik-fagl%C3%A6rte-f%C3%A5r-bedre-vilk%C3%A5r)
  - [Naalakkersuisut: mandatory pension bill notes](https://naalakkersuisut.gl/-/media/horinger/2025/09/1909_pension/em2025-12_bemrkninger_ndring-af-inatsisartutlov-om-obligatorisk-pensionsordning_dk.docx)
  - [wage.is: Greenland](https://wage.is/greenland/)

### Exchange rates
- [Bank of Canada: daily exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/)
- [Banxico: FIX](https://www.banxico.org.mx/tipcamb/tipCamMIAction.do?idioma=sp) · [Azteca Jalisco: FIX of 17 November 2026](https://www.aztecajalisco.com/noticias-jalisco-local/subio-o-bajo-el-dolar-este-es-su-precio-en-mexico-y-jalisco-hoy-miercoles-18-de-noviembre/)
- [Banguat: exchange rate](https://www.banguat.gob.gt/es/page/tipo-de-cambio) · [AllRatesToday: Banguat feed](https://allratestoday.com/es/central-bank-rates-api/banguat/)
- [El Heraldo: BCH rate of 12 November 2026](https://www.elheraldo.hn/economia/precio-dolar-honduras-para-hoy-jueves-12-noviembre-CG32616411)
- [Banco Central de Nicaragua](https://www.bcn.gob.ni/)
- [El Observador: MONEX rate](https://observador.cr/nuevo-minimo-historico-tipo-de-cambio-del-dolar-cae-a-44485-en-monex/)
- [Directorio Cubano: elTOQUE rates, November 2026](https://www.directoriocubano.info/?p=158205)
- [Jamaica Observer: forex, 19 November 2026](https://www.jamaicaobserver.com/2026/11/19/forex-159-35-one-us-dollar-20261119-2109-224234/)
- [Rio Times: BRH reference rate](https://www.riotimesonline.com/haiti-economy-key-players-2026/)
- [Revista Mercado: BCRD rate of 17 November 2026](https://revistamercado.do/money-invest/daily-news/precio-del-dolar-hoy-18-de-noviembre-de-2026-rd/)
- [Central Bank of Trinidad and Tobago](https://www.central-bank.org.tt/)
- [Banca d'Italia: ECB reference rates, 11 November 2026](https://www.bancaditalia.it/compiti/operazioni-cambi/cambio/cambi_rif_20261111)
- Pegs:
  - [Central Bank of Belize](https://www.centralbank.org.bz/)
  - [Central Bank of The Bahamas](https://www.centralbankbahamas.com/)
  - [Central Bank of Barbados](https://www.centralbank.org.bb/)
  - [Eastern Caribbean Central Bank](https://www.eccb-centralbank.org/)
  - [Cayman Islands Monetary Authority](https://www.cima.ky/)
  - [Bermuda Monetary Authority](https://www.bma.bm/)
  - [Centrale Bank van Aruba](https://www.cbaruba.org/)
  - [Central Bank of Curaçao and Sint Maarten](https://www.centralbank.cw/)
