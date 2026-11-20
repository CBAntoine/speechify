# Marquee per-venue ROI maths. Edit P (avg ticket), TPO (tickets/order) and F (venue fee), then run: python3 roi.py
P = 25.00          # face value
TPO = 2            # tickets per order
F = 2.00           # venue's own booking fee per ticket (inside the all-in price)
EB_PCT, EB_FIX, EB_PROC = 0.037, 1.79, 0.029
ST_PCT, ST_FIX = 0.029, 0.30
CLUB, HALL, CLUB_CAP = 249, 449, 2000   # $/mo, tickets/mo cap for Club

eb_absorbed = EB_PCT*P + EB_FIX + EB_PROC*P
X = (P*(1+EB_PCT) + EB_FIX) / (1-EB_PROC)  # buyer total when all fees passed on
eb_passed = X - P
order = (P+F)*TPO
stripe_per_ticket = (ST_PCT*order + ST_FIX)/TPO
kept = F - stripe_per_ticket
print(f"Eventbrite cost per $25 ticket: absorbed ${eb_absorbed:.2f}, passed-on ${eb_passed:.2f} (buyer pays ${X:.2f})")
print(f"Own box office: all-in ${P+F:.2f}; Stripe per ticket ${stripe_per_ticket:.3f}; venue keeps ${kept:.3f}/ticket")
print(f"Fan saves ${eb_absorbed - F:.2f}-${eb_passed - F:.2f} per ticket vs Eventbrite")
print(f"Break-even (Club): {CLUB/kept:.0f} tickets/month")
print("| Tickets/week | Tickets/yr | Fees kept/yr | Plan | Plan cost/yr | Net gain/yr | Return |")
for tw in (100, 200, 300, 500, 800):
    yr = tw*52; mo = yr/12
    plan, price = ("Club", CLUB) if mo <= CLUB_CAP else ("Hall", HALL)
    keptyr = yr*kept; cost = price*12
    print(f"| {tw} | {yr:,} | ${keptyr:,.0f} | {plan} | ${cost:,} | ${keptyr-cost:,.0f} | {keptyr/cost:.1f}x |")
# absorbed scenario at 300/wk
yr = 300*52
stripe_only = ST_PCT*P + ST_FIX/TPO
print(f"Absorbing venue @300/wk: Eventbrite ${eb_absorbed*yr:,.0f}/yr vs Stripe ${stripe_only*yr:,.0f} + Club ${CLUB*12:,} = ${stripe_only*yr+CLUB*12:,.0f}; saves ${eb_absorbed*yr-(stripe_only*yr+CLUB*12):,.0f}")
