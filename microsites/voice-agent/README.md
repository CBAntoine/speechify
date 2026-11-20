# Call desk: the AI agent that answers the tracking numbers

One ElevenLabs agent answers every microsite's tracking number around the clock. It keeps callers safe, qualifies the job, and records the details a plumber needs. The files here are the source of truth. If you change the agent in the dashboard, copy the change back here.

| | |
| --- | --- |
| Agent | `agent_2701m7wh5fy8ekq9vc3amy7a5cvb`, "Microsite call desk: Mississauga basement flooding (pilot)" |
| Voice | Danny - Calm, Clear & Helpful (`W93ubvztnBbrUnasPBDG`) |
| Time zone | America/Toronto |
| Prompt | [`prompt.md`](prompt.md) |
| Greeting, data fields, checks, tests | [`agent.json`](agent.json) |
| Phone number | **None yet, on purpose.** See "Before it takes real calls". |

## What it does on a call

1. **Greets and discloses.** It says it's an automated assistant, says the call is recorded, and asks straight away about water coming in or a gas smell.
2. **Safety first,** before any other question:
   - **Gas:** leave the house, then call Enbridge Gas at 1-866-763-5427 or 911 from outside.
   - **Water near outlets, the furnace or the panel:** stay out of the basement, and call Alectra Utilities at 1-833-253-2872 (option 1) to cut the power.
   - **Sewage coming up a drain:** stop using water in the house, and keep children and pets away.
3. **Qualifies the caller.** It asks:
   - what's happening
   - whether the basement has flooded before
   - whether there's a basement apartment (a shared sewer pipe rules out Peel's rebate)
   - the home type, the address and postal code, ownership, and urgency
4. **Takes contact details and consent.** It reads back the callback number and asks permission to share the details with the plumbing company.
5. **Wraps up.** It explains what happens next, with no prices, no arrival times and no promised rebates. If rebates come up, it gives the one rule that most often costs people money: the City of Mississauga's rebate needs pre-approval before work starts, and every backwater valve needs a City permit.

After every call, ElevenLabs fills in 14 data fields, including `callback_number`, `postal_code`, `issue`, `flooded_before`, `second_unit` and `consent_to_share`. It also scores three checks:

- **Qualified lead:** the number to bill a partner on.
- **Safety handled.**
- **Honest disclosure:** it never claimed to be a person, the plumber, the City or the Region, never quoted a price, and never promised a rebate or an arrival time.

## Tests

Seven tests are attached to the agent, all named `BWV pilot: ...`:

- gas smell
- water near the electrical panel
- sewage backup
- admits being automated
- no price quotes
- not the City, no rebate promise
- asks consent

History of the 2026-11-20 runs:

1. **First full run: 11 of 14.**
   - One gas-test run came back with an empty reply. It passed 3 of 3 when re-run.
   - The consent test's script skipped the urgency question, so the agent rightly asked that first. The script was fixed.
2. **The fix:** the prompt now has the agent read the number back and ask for consent in the same reply.
3. **Final run: 14 of 14** (each test twice).

Re-run them after every prompt change: open Agents → this agent → Tests in ElevenLabs, or ask Claude to "run the BWV pilot tests".

## Before it takes real calls

Don't attach a phone number until a licensed plumbing company has signed on. Every caller is a real person with water in their basement. If nobody calls back, they're worse off than if they'd never found the site.

When a partner signs:

1. **Edit "Line details"** in `prompt.md`:
   - the company name
   - any callback time they actually commit to
   - their real service area

   Push the same text to the agent, then re-run the tests.
2. **Buy one local number per site** in Twilio (Mississauga area codes: 905, 289, 365). Import it in ElevenLabs: Agents → Phone numbers → Import from Twilio. Then assign this agent. Each conversation records which number was dialled, so you can count calls per site.
3. **Decide how leads reach the partner.** Pick one or both:
   - **Post-call webhook.** In the workspace agent settings, point the post-call webhook at a small endpoint, or a Zapier or Make flow. It should email or text the partner the data fields when `consent_to_share` is true. This is a workspace-wide setting, so filter on this agent's ID, because the Sol agent shares the workspace.
   - **Live transfer.** Enable the built-in `transfer_to_number` tool with the partner's dispatch number, for emergencies during their hours.
4. **Match the privacy policy.** In the agent's advanced or privacy settings, set conversation retention to 90 days, which is what `retentionDays` promises on the site.
5. **Consider other languages.** Mississauga is very multilingual. If calls show demand, add the languages callers use and turn on the language detection tool.
6. **Change it on a branch.** Once it takes live calls, make changes on a branch (`agents_create_branch`), not main, and merge after the tests pass.

## Rules it follows, and why

- **AI and recording disclosure in the first sentence.** PIPEDA expects people to be told when they're being recorded and why. The privacy policy covers the rest, including that call data may be processed in the United States.
- **Inbound only.** It never calls, texts or emails people on its own, which keeps it clear of CASL and unsolicited-call rules.
- **Not the City or the Region.** Peel warns residents about companies that claim to work on its behalf, so the agent says plainly that it doesn't.
- **No prices, no arrival times, no promised rebates, no diagnoses stated as fact.** The plumber quotes in writing, and only the City and the Region decide rebates.
- **It collects only the intake fields.** Never payment details, dates of birth or Social Insurance Numbers.
