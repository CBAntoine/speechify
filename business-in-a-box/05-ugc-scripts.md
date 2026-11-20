# 05 · UGC video scripts

Both scripts are written for TikTok, Instagram Reels and Facebook Reels at 9:16 (1080 × 1920), with captions burned in. The presenter speaks **as Doorkeep**, never as a venue owner or customer. If an AI avatar is used, add "AI presenter" to the caption.

Delivery: warm, low-key, slightly gravelly, about 155 words per minute (about 2.6 words a second), eye contact with the lens, no "hey guys". Timings below are worked out from the word count of each line.

---

## Script A: "The Receipt" (about 35 s)

**Setting:** a presenter at a bar top in an empty venue in the afternoon, with house lights low and a printed receipt in hand (or a receipt graphic overlaid).

| Time | Voiceover | On-screen text / visual |
|---|---|---|
| 0–6 s | "Last Friday, your fans paid about three-fifty a ticket in fees. Your venue kept zero." | **$3.54 → them / $0 → you** (red, then the $0 drops in) |
| 6–10 s | "That's the ticket platform's cut. Every ticket, every show, all year." | Receipt graphic, the fee line struck through in red |
| 10–21 s | "Doorkeep gives you your own box office, paid into your own Stripe. One honest price, still lower than fans pay now, and you keep about a dollar a ticket." | **$27.75 all-in → you keep $1.05** (green) |
| 21–30 s | "Three hundred tickets a week? That's about sixteen grand a year. No monthly fee: we only earn seventy-five cents when you sell." | **~$16.3k / year** · **$0 / month** · **75¢ per ticket** |
| 30–35 s | "Want your number? Tap below and we'll run your last month of shows." | CTA: **See what you'd keep →** · end card "OWN THE DOOR" |

Fine-print caption: *Based on $25 tickets, 2 per order, a $2.75 booking fee including Doorkeep's 75¢, and Stripe's 2.9% + 30¢. Your numbers will differ.*

---

## Script B: "Doors at 7" (about 40 s)

**Setting:** handheld point-of-view walk through an empty room at 3 PM: chairs up, stage, bar, front door. Cut to a door person scanning a phone ticket. The presenter appears from 16 s.

| Time | Voiceover | On-screen text / visual |
|---|---|---|
| 0–5 s | "If you run a room that holds three hundred people, this one's for you." | **300-cap room?** over the empty stage |
| 5–16 s | "Right now, a ticket site sits between you and every fan. It takes a fee on each ticket, owns the checkout, and makes your fans pay more." | Slow push on the front door · **fee on every ticket** |
| 16–27 s | "We build you your own box office in seven days. Your logo, your domain, your Stripe account. Door staff scan tickets on their phones. Your list is yours." | Presenter on camera · quick cuts: branded checkout, phone scan, customer export |
| 27–35 s | "Fans see one all-in price, usually lower than they pay now, and the booking fee stays with the house. No monthly fee." | **Fans pay less. The house keeps the fee. $0/month.** |
| 35–40 s | "Doorkeep. Own the door. Book a ten-minute fee check: link below." | End card letterboard "OWN THE DOOR" + CTA **Book a fee check →** |

Fine-print caption: *"Usually lower" holds for $12–$40 tickets against a major self-serve platform's US fees. Doorkeep earns 75¢ per paid ticket (50¢ under $20).*

---

## Production options

1. **Real presenter (best):** the founder films both scripts in a real venue on a weekday afternoon. That takes about an hour with a phone and a lavalier mic.
2. **AI avatar:** needs an avatar video tool. Graph, as used in the reference video, isn't connected to this workspace. Paste the scripts in once a tool is connected and keep the "AI presenter" label.
3. **Faceless edit:** voiceover generated with the connected ElevenLabs account, laid over captions and venue b-roll (licensed stock or footage you shoot).

## Produced: faceless versions (2026-11-20)

| File | Length | Voice |
|---|---|---|
| [`video/doorkeep-ugc-a-the-receipt.mp4`](video/doorkeep-ugc-a-the-receipt.mp4) | 33.7 s | ElevenLabs "Paul O'Banion" (warm, slightly gravelly, American), eleven_v4, take 1 of 2 |
| [`video/doorkeep-ugc-b-doors-at-7.mp4`](video/doorkeep-ugc-b-doors-at-7.mp4) | 37.4 s | Same voice, take 1 of 2 |

- **Format:** 1080 × 1920, 30 fps, H.264 + AAC. Each spoken line is a slide in the brand style, with the line as a burned-in caption. Captions sit inside the safe zone, between 14% from the top and 20% from the bottom.
- **Motion:** each slide slowly pushes in, with a 0.3 s crossfade between slides and a 1.8 s end-card hold.
- **Timing:** slide cuts are timed to the pauses at the end of each spoken line.
- **Cost:** four takes cost 2,100 ElevenLabs credits (about $0.42). The second takes are in the ElevenLabs flow "Doorkeep UGC voiceovers".
- **Rebuild:** `node video/src/render_slides.cjs && python3 video/src/build_videos.py`, run from `business-in-a-box/`.
- **Before running these as paid ads,** check that your ElevenLabs plan includes commercial use. Swap in venue b-roll or a real presenter when you have them: faces and real rooms usually outperform text-only video.
