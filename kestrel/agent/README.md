# The Kestrel voice agent (ElevenLabs)

- **Agent:** `agent_3501m848amfwebpb33148k4j728f` ("Kestrel"), main branch `agtbrch_5901m848aq5gea7tgchaeyycx9xr`
- **Model:** Claude Haiku 5.5, low reasoning effort, temperature 0
- **Voice:** "Jake – Natural, Calm and Confident" (`CDdUdrzh7qrDE2xpRZyQ`)
- **Private:** authentication is on, so conversations need a token that the app gets with the person's API key. Typed chat is allowed (the `text_only` override).
- **Prompt:** [`prompt.md`](prompt.md). **Tools:** [`tools.json`](tools.json) (the same definitions as on ElevenLabs).

All 14 tools are client tools: the browser runs them (`public/voice.js`) by calling `POST /api/agent/tool`, which lands in `src/tools.mjs`.

| Tool | ElevenLabs id |
| --- | --- |
| get_overview | `tool_1901m848bmqveszv2m8ge3vhvrxc` |
| get_positions | `tool_5601m848bna0fdmbsqcsjq148a8q` |
| get_trades | `tool_9001m848bnxaft4bh3cbkgh3ggxj` |
| get_activity | `tool_1701m848bperfanbmfyezdn4npyz` |
| get_market | `tool_7501m848bq02ex48z9fb0k3xyjx8` |
| explain_decision | `tool_0801m848bqjyezbvk2annd20w8yn` |
| run_backtest | `tool_5101m848br77fyb899zj660bmy4n` |
| get_backtest | `tool_1301m848brx0e7bv34w3q18rzsdf` |
| control_bot | `tool_4701m848bsfse1asvzx3hr528dsz` |
| set_risk | `tool_8701m848bt4xfspsqm3q71xh73e1` |
| manage_markets | `tool_7401m848btpdef4t2k05mjzybnkp` |
| place_order | `tool_7001m848bv6zfh5bt2v7ht8qwthc` |
| get_setup | `tool_8001m848bvy4f1hat9fz4vqr0vjk` |
| show_on_screen | `tool_5701m848bx4segqs6687smexr5nf` |

## Tests (attached to the agent; all pass)

| Test | Checks |
| --- | --- |
| `test_8901m84vmjmbe43sqmwhafesgbrd` | "How am I doing today?" calls get_overview |
| `test_1401m84vmk8tejwvkaqg4vn92feh` | A question about Ethereum calls get_market for Ethereum |
| `test_2001m84vmkyee889kbqjnrrw098m` | "Sell everything" calls control_bot with sell_all (which then asks for confirmation) |
| `test_2201m84vmmjnfe0vtpemhv0n0qwj` | After the person says yes, place_order is called with exactly the confirm_token it was given |
| `test_5501m84vmndwfqt8nj2tjze3bng9` | After the person says no, no order is placed |
| `test_7701m84vmnzye1sbxmf72cp2tyxq` | Never promises or guarantees profits |
| `test_4901m84vmq74f12rdtz9692n4k7x` | Can't switch on real money by voice; points to the dashboard; never asks for keys |

When you change the prompt or a tool, change these files too, and re-run the tests from the agent's Tests tab (or ask Claude Code: this repo's `.claude/settings.json` pre-approves the agent tools).
