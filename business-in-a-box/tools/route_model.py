# Doorkeep route model: compares pricing models per venue and a 12-month founder scenario.
# Run: python3 route_model.py
P, TPO = 25.00, 2                      # avg ticket face value, tickets per order
ST_PCT, ST_FIX = 0.029, 0.30           # Stripe US per order
EB_PCT, EB_FIX, EB_PROC = 0.037, 1.79, 0.029
INFRA = 45                             # $/venue/month, midpoint of the $30-60 estimate
EUR_USD = 1.08                         # rough conversion for the Hi.Events platform licence comparison

eb_fan_total = (P * (1 + EB_PCT) + EB_FIX) / (1 - EB_PROC)  # buyer pays this when fees are passed on

def stripe_per_ticket(fan_fee):
    return (ST_PCT * (P + fan_fee) * TPO + ST_FIX) / TPO

def flat(tw):
    mo = tw * 52 / 12
    price = 249 if mo <= 2000 else 449
    fan_fee = 2.00
    kept = (fan_fee - stripe_per_ticket(fan_fee)) * tw * 52
    ours = price * 12
    return dict(fan=P + fan_fee, ours=ours, venue_net=kept - ours)

def per_ticket(tw, fee, minimum=0):   # no monthly minimum (decision 2026-11-20); volume is qualified instead
    mo_tickets = tw * 52 / 12
    fan_fee = 2.00 + fee                       # the venue's ~$1.07 is preserved; our fee sits on top
    ours_mo = max(minimum, fee * mo_tickets)
    topup_yr = (ours_mo - fee * mo_tickets) * 12   # venue pays any shortfall to the minimum
    kept = (fan_fee - stripe_per_ticket(fan_fee) - fee) * tw * 52
    return dict(fan=P + fan_fee, ours=ours_mo * 12, venue_net=kept - topup_yr)

def platform_licence_eur(gmv_eur):
    # Hi.Events platform price bands (hi.events/licensing, 2026-11-20); above EUR 3M is quoted
    bands = [(200e3, None), (300e3, 14), (750e3, 13), (1.5e6, 10), (3e6, 7.5)]
    cost, prev = 3999.0, 200e3
    for top, rate in bands[1:]:
        if gmv_eur > prev:
            cost += (min(gmv_eur, top) - prev) / 1000 * rate
        prev = top
    return cost

print(f"Eventbrite all-in to the fan (fees passed on): ${eb_fan_total:.2f}\n")
models = [("Flat $249/$449 mo", flat),
          ("$0.50/ticket", lambda tw: per_ticket(tw, 0.50)),
          ("$0.75/ticket", lambda tw: per_ticket(tw, 0.75)),
          ("$1.00/ticket", lambda tw: per_ticket(tw, 1.00))]
print("| Model | Tickets/wk | Fan pays | Fan saves vs EB | Doorkeep revenue/yr | Doorkeep profit/yr | Venue net gain/yr |")
print("|---|---|---|---|---|---|---|")
for name, fn in models:
    for tw in (100, 300, 800):
        r = fn(tw)
        print(f"| {name} | {tw} | ${r['fan']:.2f} | ${eb_fan_total - r['fan']:.2f} | ${r['ours']:,.0f} | ${r['ours'] - INFRA*12:,.0f} | ${r['venue_net']:,.0f} |")

# 12-month founder scenario: 2 new venues signed per month, each averaging 300 tickets/week
print("\n12-month scenario: +2 venues/month, 300 tickets/week each")
venue_months = sum(2 * m for m in range(1, 13))   # venue-months billed in year one
for name, fn in models:
    per_mo = fn(300)["ours"] / 12
    rev = per_mo * venue_months
    print(f"  {name:18s} year-1 revenue ${rev:,.0f} | infra ${INFRA*venue_months:,.0f} | month-12 run-rate ${per_mo*24*12:,.0f}/yr")

# Shared multi-tenant install: Hi.Events platform licence cost at 24 venues x 300 tickets/week
gmv_usd = 24 * 300 * 52 * (P + 2.75)
lic = platform_licence_eur(min(gmv_usd / EUR_USD, 3e6))
print(f"\nShared install for 24 venues: GMV ${gmv_usd:,.0f}/yr -> platform licence at least EUR {lic:,.0f}/yr "
      f"(EUR 3M band; above that is quoted) vs EUR 0 for per-venue installs on the free AGPL edition")

# --- Check 1: does the fan still pay less than Eventbrite at every ticket price? ---
def eb_fee(p):
    return (p * (1 + EB_PCT) + EB_FIX) / (1 - EB_PROC) - p
print("\nFan fee vs Eventbrite by ticket price (venue fee $2.00; Doorkeep 50c under $20, 75c from $20):")
for p in (12, 15, 20, 25, 40):
    ours = 0.50 if p < 20 else 0.75
    fan_fee = 2.00 + ours
    stripe = (ST_PCT * (p + fan_fee) * TPO + ST_FIX) / TPO
    print(f"  ${p:>2} ticket: Eventbrite fee ${eb_fee(p):.2f} | Doorkeep all-in fee ${fan_fee:.2f} "
          f"(fan saves ${eb_fee(p) - fan_fee:.2f}) | venue keeps ${fan_fee - stripe - ours:.2f}/ticket")

# --- Check 2: licence downside per venue at 300 tickets/week ---
def standard_licence_eur(sales):
    bands = [(10e3, None), (30e3, 12), (60e3, 13), (150e3, 12), (300e3, 10), (750e3, 9.5), (1.5e6, 9), (3e6, 5.5)]
    cost, prev = 249.0, 10e3
    for top, rate in bands[1:]:
        if sales > prev:
            cost += (min(sales, top) - prev) / 1000 * rate
        prev = top
    return cost
sales_eur = 300 * 52 * (P + 2.75) / EUR_USD
std = standard_licence_eur(sales_eur) * EUR_USD
plat = platform_licence_eur(sales_eur) * EUR_USD
print(f"\nLicence downside at 300 tickets/week (sales ~EUR {sales_eur:,.0f}/yr): "
      f"standard licence ${std:,.0f}/yr, platform licence ${plat:,.0f}/yr")
for name, rev in (("Flat $249", flat(300)["ours"]), ("$0.75/ticket", per_ticket(300, 0.75)["ours"])):
    base = rev - INFRA * 12
    print(f"  {name:13s} profit/venue: free AGPL ${base:,.0f} | if standard licence ${base - std:,.0f} | if platform licence ${base - plat:,.0f}")
