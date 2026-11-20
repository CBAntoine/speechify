# Doorkeep per-venue ROI maths (per-ticket pricing). Edit the inputs, then run: python3 roi.py
P = 25.00          # average face value
TPO = 2            # tickets per order
VENUE_FEE = 2.00   # the venue's own booking fee per ticket
TICKETS_PER_WEEK = 300
EB_PCT, EB_FIX, EB_PROC = 0.037, 1.79, 0.029   # Eventbrite US: 3.7% + $1.79 per ticket, 2.9% processing
ST_PCT, ST_FIX = 0.029, 0.30                   # Stripe US: 2.9% + 30c per order

ours = 0.50 if P < 20 else 0.75                # Doorkeep per paid ticket
fan_fee = VENUE_FEE + ours
eb_fan_total = (P * (1 + EB_PCT) + EB_FIX) / (1 - EB_PROC)   # fees passed on to the fan
eb_absorbed = EB_PCT * P + EB_FIX + EB_PROC * P               # fees absorbed by the venue
stripe = (ST_PCT * (P + fan_fee) * TPO + ST_FIX) / TPO
kept = fan_fee - stripe - ours
yr = TICKETS_PER_WEEK * 52

print(f"Eventbrite: fan pays ${eb_fan_total:.2f} (fees ${eb_fan_total - P:.2f}); venue keeps $0.00")
print(f"Doorkeep:    fan pays ${P + fan_fee:.2f} all-in (saves ${eb_fan_total - P - fan_fee:.2f}); "
      f"Stripe ${stripe:.3f}, Doorkeep ${ours:.2f}, venue keeps ${kept:.3f}/ticket")
print(f"At {TICKETS_PER_WEEK} tickets/week: venue keeps ${kept * yr:,.0f}/yr; Doorkeep earns ${ours * yr:,.0f}/yr; no monthly fee")

absorb_stripe = ST_PCT * P + ST_FIX / TPO
absorbed_cost = (absorb_stripe + ours) * yr
print(f"If the venue absorbs fees today: Eventbrite ${eb_absorbed * yr:,.0f}/yr vs Doorkeep (Stripe + our fee) "
      f"${absorbed_cost:,.0f}/yr, saving ${eb_absorbed * yr - absorbed_cost:,.0f}/yr")
