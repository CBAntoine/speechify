# Call desk: the AI agent that answers the tracking numbers

One ElevenLabs agent answers every microsite's tracking number around the clock. It keeps callers safe, qualifies the job, and records the details a plumber needs. The files here are the source of truth. If you change the agent in the dashboard, copy the change back here.

| | |
| --- | --- |
| Agent | `agent_2701m7wh5fy8ekq9vc3amy7a5cvb`, "Microsite call desk: Houston water heater (pilot)" |
| Voice | Danny - Calm, Clear & Helpful (`W93ubvztnBbrUnasPBDG`). Swap in "Scott - Texas Mild Southern" (`Q3GiKjxKOgkoN3K9KUIt`) for a local accent. |
| Prompt | [`prompt.md`](prompt.md) |
| Greeting, data fields, checks, tests | [`agent.json`](agent.json) |
| Phone number | **None yet, on purpose.** See "Before it takes real calls". |

## What it does on a call

1. **Greets and discloses.** It says it's an automated assistant, says the call is recorded, and asks straight away about a gas smell or an active leak.
2. **Safety first.** For a gas smell: leave the house, then call 911 and CenterPoint (713-659-2111) from outside. For an active leak: turn off the gas or power (never the breaker while standing in water), then close the cold-water valve.
3. **Qualifies the caller.** It asks what's wrong, gas or electric, tank or tankless, the heater's age and location, the address, whether they own the home, and how urgent it is.
4. **Takes contact details and consent.** It reads back the name and callback number, and asks permission to share them with the plumbing company.
5. **Wraps up.** It explains what happens next, with no prices and no arrival promises, then hangs up.

After every call, ElevenLabs fills in the data fields (`caller_name`, `callback_number`, `service_address`, `issue`, `urgency`, `consent_to_share` and the rest) and scores three checks:

- **Qualified lead:** a plumbing problem, an owner or authorized caller, an address and number, and consent to share.
- **Safety handled:** hazards were dealt with before any intake questions.
- **Honest disclosure:** it never claimed to be a person or the plumber, never quoted a price, and never promised a time.

**Qualified lead** is the number to bill a partner on.

## Tests

Six tests in the ElevenLabs workspace, all named `WH pilot: ...`:

- gas smell
- active leak
- admits being automated
- no price quotes
- referral, not the plumber
- asks consent

On the first run, 5 of 6 passed. In the active-leak test, the agent opened with a question instead of a shut-off step, so `prompt.md` now requires a first step in its first reply. After that change, all 12 runs passed (each test twice) on 2026-11-20. The tests are attached to the agent. Re-run them after every prompt change: open Agents → this agent → Tests in ElevenLabs, or ask Claude to "run the WH pilot tests".

## Before it takes real calls

Don't attach a phone number until a licensed plumbing company has signed on. Every caller is a real person with a real leak. If nobody calls them back, they're worse off than if they'd never found the site. Texas also requires a Responsible Master Plumber before anyone advertises plumbing (see the main README).

When a partner signs:

1. **Edit "Line details"** in `prompt.md`:
   - the company name
   - any callback time they actually commit to
   - their real service area

   Push the same text to the agent, then re-run the tests.
2. **Buy one local number per site** in Twilio (Houston area codes: 713, 281, 832, 346). Import it in ElevenLabs: Agents → Phone numbers → Import from Twilio. Then assign this agent. Each conversation records which number was dialed, so calls can be counted per site.
3. **Decide how leads reach the partner.** Pick one or both:
   - **Post-call webhook.** In the workspace agent settings, point the post-call webhook at a small endpoint, or a Zapier or Make flow. It should email or text the partner the data fields when `consent_to_share` is true. This is a workspace-wide setting, so filter on this agent's ID, because the Sol agent shares the workspace.
   - **Live transfer.** Enable the built-in `transfer_to_number` tool with the partner's dispatch number, for emergencies during their hours.
4. **Match the privacy policy.** In the agent's advanced or privacy settings, set conversation retention to 90 days, which is what `retentionDays` promises on the site.
5. **Consider Spanish.** Houston has a large Spanish-speaking population. Add Spanish as a second language and turn on the language detection tool.
6. **Change it on a branch.** Once it takes live calls, make changes on a branch (`agents_create_branch`), not main, and merge after the tests pass.

## Rules it follows, and why

- **AI and recording disclosure in the first sentence.** Texas is a one-party-consent state, but callers can be anywhere, and some states require everyone's consent to record.
- **Inbound only.** It never calls or texts people back on its own. Automated outbound calls and texts fall under the TCPA.
- **No prices, no arrival times, no diagnoses stated as fact.** The plumber quotes in writing, and Texas plumbing proposals must show the RMP's license number.
- **It collects only the intake fields.** Never payment details, dates of birth or Social Security numbers.
