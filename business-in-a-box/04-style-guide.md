# 04 · Style guide: Doorkeep

**Positioning line:** *Own the door.*
**Support line:** *Your tickets. Your fee. Your fans.*

The brand should feel like the venue after soundcheck: house lights down, marquee bulbs on, and someone straight-talking you through the numbers on a napkin. It's warm and backstage, never corporate SaaS and never "hustle bro".

## Colour

| Token | Hex | Use | Contrast |
|---|---|---|---|
| Stage Black | `#14111A` | Default background for ads, video end cards and decks | — |
| Ticket Cream | `#F4EBD9` | Letterboard panels, receipts, light backgrounds, body text on black | 15.8:1 on Stage Black |
| Bulb Gold | `#FFC233` | Doorkeep bulbs, highlights, CTA buttons, the one word that matters | 11.6:1 on Stage Black |
| Cash Green | `#3DBE7A` | Money the venue **keeps** (on dark) | 7.9:1 on Stage Black |
| Curtain Red | `#E5483B` | Money the venue **loses** to platforms (on dark) | 4.7:1 on Stage Black |
| Smoke | `#A39CAD` | Secondary text and fine print on dark | 7.0:1 on Stage Black |
| Deep Green | `#1E7A4C` | "Kept" figures on cream | 4.5:1 on Ticket Cream |
| Deep Red | `#A3261C` | "Lost" figures on cream | 6.2:1 on Ticket Cream |

Rules:
- **Green means the venue's money, red means the platform's.** Never swap them, and never use either for decoration.
- **Never put Bulb Gold text on Ticket Cream** (1.4:1, unreadable). On cream, gold appears only as bulbs or shapes.
- Each layout uses one accent colour, plus green and red only where there's money on the canvas.

## Type

| Role | Font | Settings |
|---|---|---|
| Display / letterboard | **Anton** (Google Fonts, OFL) | UPPERCASE, tracking +2%, line-height 0.95 |
| Body | **Inter** (OFL) | 400/600, sentence case, 1.35 line-height |
| Numbers, receipts, fine print | **JetBrains Mono** (OFL) | Tabular figures, right-aligned in receipts |

Headlines are 2–6 words. Money figures are the biggest thing on the canvas whenever they appear.

## Visual motifs (use one per piece)

1. **The marquee letterboard:** cream panels, black Anton letters, a row of gold bulbs around the frame. Use for brand statements ("KEEP THE FEE").
2. **The receipt:** a cream paper strip in JetBrains Mono. The platform line "Fees to you: $0.00" is in red (not struck through, which reads as if the venue gets something); the venue's kept line is in green. Use for fee comparisons.
3. **The torn ticket:** a stub with a perforated tear. The left side is what the platform takes, the right side is what the venue keeps. Use for comparisons.
4. **House lights:** an almost black stage with one warm spotlight. Use as the background for single big numbers.

Photography and video b-roll: real empty rooms in the afternoon (stage, bar, door, chairs up). Shoot from behind the crowd, never smiling stock faces. No AI-generated faces in static ads.

## Copy rules

**Do**
- **Lead with a number, and source every number.** Any dollar figure in an ad carries a fine-print line with its assumptions, e.g. *"$25 ticket, 2 per order, $2.75 booking fee incl. Doorkeep's 75¢, Stripe 2.9% + 30¢."*
- **Talk like the venue talks:** the door, the room, capacity, doors at 7, on-sale, settlement. Use sparingly and correctly.
- **Use honest-price language:** "one all-in price", "the fee stays with the house".
- **Keep the reading level at grade 6–8:** short sentences, contractions fine.
- **Use outcome CTAs:** "See what you'd keep", "Run my numbers", "Book a 10-minute fee check".

**Don't**
- Don't say "free ticketing", "zero fees" or "commission-free". Doorkeep earns 75¢ a ticket and Stripe charges 2.9% + 30¢, and owners know it. Say **"no monthly fee"** instead, which is true: there is no subscription, minimum or setup fee.
- Don't name competitors or use their logos or colours in public ads. Say "ticketing platforms" or "the big ticket sites". Naming Eventbrite with sourced rates is fine in one-to-one sales emails and calls.
- **No fake testimonials, reviews or invented case studies**, including AI avatars posing as venue owners (FTC rule on consumer reviews and testimonials). Presenters speak as Doorkeep.
- No hype words: revolutionary, game-changer, AI-powered, skyrocket, unlock.
- Don't promise uptime, payout timing or support hours beyond what the support plan covers.

## Ad specs (Meta)

| Placement | Size | Notes |
|---|---|---|
| Feed (primary) | 1080 × 1350 (4:5) | Headline in the top third; CTA band at the bottom |
| Feed (square) | 1080 × 1080 | For carousels and retargeting |
| Stories / Reels | 1080 × 1920 (9:16) | Keep the top 14% and bottom 20% free of text |

- Primary text: hook within the first 125 characters (before "See more").
- Headline field: up to 6 words. Description: the assumptions line.
- Fine print at least 22 px on 1080 px canvases, in Smoke on dark or Stage Black on cream.

## The five launch statics

Rendered as 1080 × 1350 PNGs in [`ads/`](ads/). Source: `ads/src/ads.html`. Re-render with `node business-in-a-box/ads/src/render.cjs`.

| # | File | Motif | Headline | Payload | CTA |
|---|---|---|---|---|---|
| 1 | `01-the-receipt.png` | Receipt | YOUR FANS PAID A FEE. YOU KEPT $0. | Platform receipt: ticket $25.00, platform fees $3.54, fan pays $28.54, "Fees to you: $0.00" in red. Box-office receipt: ticket $25.00, booking fee $2.75, fan pays $27.75, "Fee to you: $1.05" in green. Stamp: FANS PAY 79¢ LESS. | See what you'd keep |
| 2 | `02-keep-the-fee.png` | Letterboard | KEEP THE FEE | "Your box office. Your Stripe. Your fans." + "No monthly fee. We earn 75¢ only when you sell." | See what you'd keep |
| 3 | `03-the-big-number.png` | House lights | $16,306 | "What a 300-ticket-a-week room keeps in a year, with its own box office. No monthly fee." | Run my numbers |
| 4 | `04-same-ticket.png` | Torn ticket | SAME TICKET. DIFFERENT WINNER. | Left stub: $3.54 in fees, $0 to you. Right stub: $1.05 to you per ticket. "And your fans pay 79¢ less." | See what you'd keep |
| 5 | `05-seven-days.png` | Letterboard as run-of-show | YOUR BOX OFFICE. LIVE IN 7 DAYS. | MON kickoff call → TUE box office built → WED shows loaded → THU on your website → FRI door drill → SAT your list emailed → SUN on sale. "No monthly fee. No setup fee." | Book a 10-minute fee check |

Every figure matches `tools/roi.py` ($25 ticket, 2 per order, $2.75 booking fee, Stripe 2.9% + 30¢), and every ad carries its assumptions line.

**Meta ad fields** (primary text kept under 125 characters):

| # | Primary text | Headline | Description |
|---|---|---|---|
| 1 | Your fans paid about $3.50 a ticket in fees last show. Your venue kept none of it. Your own box office changes that. | Keep your booking fee | No monthly fee. 75¢ a ticket. Live in 7 days. |
| 2 | Fans already pay a booking fee. With your own box office, it stays with the house. No monthly fee. | Keep the fee | Your box office. Your Stripe. Your fans. |
| 3 | A 300-ticket-a-week room keeps about $16k a year with its own box office. Want your number? We'll run it in 10 minutes. | See what you'd keep | Example: $25 tickets, 2 per order, $2.75 fee incl. our 75¢. |
| 4 | Same ticket, different winner: on your own box office you keep $1.05 a ticket and fans pay 79¢ less than on the big sites. | Same ticket. Different winner. | $25 ticket, US platform fees as of Nov 2026. |
| 5 | Your own branded box office, live in 7 days. We move your shows, train your door staff and email your list. No monthly fee. | Live in 7 days | 75¢ per paid ticket. Shows on sale stay put. |

## Video (UGC) look

- 9:16, captions burned in (Inter 600, cream on a 70% Stage Black box), with key numbers popping in Bulb Gold or Cash Green.
- End card: the letterboard with "OWN THE DOOR", the Doorkeep wordmark and the CTA, for 2 seconds.
- **If an AI avatar presents,** it speaks as a Doorkeep presenter, never as a customer, and the caption carries "AI presenter".
