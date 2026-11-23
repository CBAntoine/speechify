# Kestrel: a trading bot you can talk to

Kestrel trades for you around the clock. It reads every market seven different ways, buys clear uptrends, steps aside in downtrends, and puts a stop under every position. You can practice with pretend money at real prices (no account needed), test it on years of real history, and when you're ready, trade real money through Alpaca, Kraken, Coinbase and 100+ other exchanges.

Its voice is **Kestrel**, an ElevenLabs agent that sees everything the bot does, as it happens. It already exists in your ElevenLabs account, with its tools and tests.

> "How am I doing?" · "Why did you buy Ethereum?" · "What's the riskiest thing right now?" · "Test Solana over the last two years." · "Pause trading." · "Sell everything."

**Read this first.** No trading system can promise profits, and this one doesn't. Markets can fall fast, and fees matter a lot. In two years of real crypto history (a crash where buying and holding lost about half), Kestrel's job turned out to be protecting money more than making it (see [What the tests showed](#what-the-tests-showed)). Only trade money you can afford to lose.

## What it does

- **Trades by itself.** Every 4 hours for crypto (daily for stocks), it decides for the whole portfolio: what to buy, how much, what to sell. Between decisions it checks prices every 15 seconds so stops fire on time.
- **Explains everything in plain words.** Every trade says why ("bullish (score +0.42): uptrend, the 20-bar average is above the 100-bar average; broke above its 55-bar high"). Every market shows the bot's view, the market's mood and each expert's opinion.
- **Practice with pretend money at real prices.** $10,000 to start, live prices from Kraken (or Coinbase or Alpaca), and that exchange's real fees, so practice looks like the real thing.
- **Real money, carefully.** It trades only the budget you give it, never touches anything else in your account, and has a largest-order limit, a daily loss limit and a safety stop.
- **Tests on real history.** Pick markets and a period; it replays the past through the same code that trades, with fees, compares itself with just buying and holding, and shows a range of one-year outcomes (Monte Carlo).
- **Talks and listens** through ElevenLabs, or you can type. Everything also works by clicking.

## How it decides

**Seven experts** each read the market their own way and give an opinion from −1 (bearish) to +1 (bullish):

| Expert | What it looks at |
| --- | --- |
| Trend | Moving averages: price climbing or sliding over days and weeks |
| Momentum | How far price moved over 4, 12, 28 and 56 days, adjusted for how jumpy it is |
| Breakout | Turtle rules: a break above the 55-bar high, out on a 20-bar low |
| Trend filter | A Kalman filter that separates the real drift from noise |
| MACD | A slow MACD: is the trend speeding up or fading? |
| Bounce | In choppy markets only: oversold dips and overbought spikes |
| Self-learning model | An online logistic regression that keeps retraining on recent bars |

**A meta-learner** (fixed-share Hedge, a standard online-learning method) gives more say to the experts that have been right lately, and never writes any off, so the mix re-adapts when the market changes character. Everything learns only from bars that have closed, in order; a test checks that nothing looks ahead.

**The risk manager** turns that opinion into a position:
- Buys only above a score threshold, and only when the price is above its long-term average (the classic "trade with the big trend" rule). Holding takes a weaker signal than buying, so it doesn't churn.
- Sizes each position to a volatility target, then scales the whole portfolio down so that, counting how much coins move together, the total stays within that target.
- A trailing stop under every position (it only moves up), a cooling-off period after a stop, a daily loss limit (no new buys until midnight UTC) and a safety stop (sells everything and pauses after a set drop from the peak).
- Three levels: **Careful** (safety stop at −12%), **Balanced** (−20%, the default) and **Bold** (−35%).

**Patient orders.** Fees decide whether a bot like this makes money, so Kestrel places a limit order at the best price to pay the lower "maker" fee, and only falls back to a market order after 90 seconds. Stops and "sell now" go out at market immediately.

## What the tests showed

Real hourly data from Coinbase, November 2024 to November 2026, Bitcoin + Ethereum + Solana, 4-hour decisions, all safety rules on, Balanced. Over this period buying and holding the three lost about half (−48% to −53%) with a worst dip of −64%.

| Fees (maker / taker) | Exchange | Kestrel | Kestrel's worst dip | Buy and hold |
| --- | --- | --- | --- | --- |
| 0.15% / 0.25% | Alpaca crypto | about +9% | about −24% | −53% |
| 0.25% / 0.40% | Kraken Pro | between −4% and +6% (depends on the exact window) | about −24% | −48% to −53% |
| 0.60% / 1.20% | Coinbase base tier | about −24% | about −33% | −53% |

What that means:
- **It protected money in the crash**: down quarters cost it 1–4% while holding lost up to 50%. It caught part of the rallies, not all of them.
- **Fees decide everything.** The same strategy goes from positive to badly negative between Alpaca/Kraken fees and Coinbase's base tier. Prefer low-fee exchanges.
- **Results are sensitive.** Moving the start date or a setting by a little moves the result by several percent. The Test page shows the Monte Carlo range for that reason: for the portfolio above, a typical year ran from roughly −28% to +42%, with about a 50% chance of a losing year.
- On hourly bars, none of the signals predicted anything after costs; on 4-hour bars, trend, momentum and the trend filter did. That's why it decides every 4 hours.

Run the test yourself: the **Test a strategy** page, or `npm run backtest -- BTC/USD ETH/USD SOL/USD --days 730 --venue kraken`.

## Get started

1. **Install Node.js** (version 20 or newer) from <https://nodejs.org>. The LTS button is fine.
2. **Get this folder** onto your computer (clone the repo, or download it as a ZIP from GitHub and unzip it).
3. **Start Kestrel:**
   - Mac: double-click `start-mac.command` (the first time, right-click → Open).
   - Windows: double-click `start-windows.bat`.
   - Linux, or any terminal: `npm install` once, then `npm start`.

   Your browser opens at <http://localhost:4747>. A three-step setup asks what to trade and how bold to be, then it starts trading pretend money at real prices.
4. **Turn on the voice:** in ElevenLabs, go to *Developers → API keys*, create a key with the **ElevenLabs Agents** permission set to *Write*, and paste it into Kestrel's **Settings**. The key stays on your computer and is only used to start each conversation. Then press **Talk to Kestrel** and allow the microphone, or just type in the box.

Keep the window that started Kestrel open while you use it. **Kestrel only watches your stops while it's running**: if you trade real money, run it on a computer that stays on.

### Watch it trade without waiting

`npm run demo` starts Kestrel on a **simulated market** where each 4-hour bar takes about 4 seconds, with $10,000 of pretend money. Nothing in the demo is real.

## Real money, step by step

1. **Connect your exchange** on the **Connect** page. Create an API key that can **trade but not withdraw** (each exchange's card has the exact steps and a link to its key page). Kestrel checks the key by reading your balance, then keeps it in `.data/secrets.json`, readable only by you.
2. **Rehearse (optional, recommended):** connect Alpaca's free **paper** account and switch it on as below. It's pretend money at a real broker, so you see real order handling.
3. **Switch on real money** on the Connect page: pick the account, set the **budget** Kestrel may use and the **largest single order**, and type **REAL MONEY**. The voice assistant can't do this step.
4. **Press Start.** You can pause, sell everything or go back to practice at any time.

Which exchange? Kestrel works with any of these (fees are each one's published base tier; your account may be lower):

| Exchange | What | Fees | Notes |
| --- | --- | --- | --- |
| **Alpaca** | US stocks, ETFs, crypto | stocks free, crypto 0.15% / 0.25% | Free paper account. Low fees. |
| **Kraken** | crypto | 0.25% / 0.40% | Canada, most US states, UK, Europe. |
| Coinbase | crypto | 0.60% / 1.20% | Easy, but base-tier fees eat most of the edge. |
| Gemini, Bitstamp, Crypto.com | crypto | 0.20–0.30% / 0.40–0.50% | |
| Binance.US, Binance, OKX, Bybit, KuCoin | crypto | about 0.10% | Not available everywhere: Binance, Bybit and OKX don't serve US residents, Binance and Bybit left Canada, and KuCoin isn't available in the US or Ontario. |
| Any other CCXT exchange | crypto | varies | Generic key fields. |

Check that an exchange serves where you live before you sign up. In an account that holds Canadian dollars (or euros), Kestrel trades pairs like BTC/CAD automatically.

## How Kestrel keeps you safe

- It only uses the budget you give it, and never touches anything else in your account.
- Every position has a trailing stop that only moves up.
- A bad day past the daily limit stops new buys until midnight UTC; a drop past the safety limit sells everything and pauses until you resume.
- It stops itself after 5 failed orders in a row, or 60 orders in a day.
- It skips an order when the price looks wrong (more than 15% from the last close), caps buys at your largest-order limit and at the cash actually free in your account, and checks every 10 minutes that the account still holds what it bought.
- Real money is switched on only on the dashboard. A real-money order asked for by voice needs your spoken yes **and** a tap on Approve.
- The dashboard only answers on this computer: every request needs this session's secret token, the Host header must be localhost (which stops DNS-rebinding attacks), writes from other websites are refused, and a strict Content-Security-Policy is set.
- API keys never reach the web page. Everything Kestrel does is appended to `.data/journal.jsonl`.

## The voice assistant

The ElevenLabs agent **Kestrel** (`agent_3501m848amfwebpb33148k4j728f`) is private: Kestrel asks ElevenLabs for a short-lived conversation token with your key each time you talk. It runs on Claude Haiku 5.5 with the "Jake" voice. Its 14 tools are ElevenLabs **client tools**: ElevenLabs asks your browser to run them, and the browser asks Kestrel on your computer, so your exchange keys and account never leave your computer.

It knows what's happening because the page tells it: a full briefing when a conversation starts, then a note the moment anything happens (a trade, a stop, a safety stop, a market turning bullish or bearish, a finished test) and which page you're looking at.

| Tool | Does |
| --- | --- |
| `get_overview`, `get_positions`, `get_trades`, `get_activity` | Money, holdings with stops, finished trades and orders, the activity feed |
| `get_market`, `explain_decision` | One market's view and reasons; why the bot did or didn't do something |
| `run_backtest`, `get_backtest` | Test on real history and report against buying and holding |
| `control_bot` | Start, pause (immediate), resume, sell everything |
| `set_risk`, `manage_markets`, `place_order` | Change risk, add or remove markets, buy or sell |
| `get_setup`, `show_on_screen` | Connections and fees; switch the dashboard page or chart |

Anything that changes the bot (except pausing and lowering risk) returns a summary and a one-time confirmation token: the agent reads the summary back, and only after your yes does it call again with that token. Seven agent tests (status, market lookup, sell-everything, using the token after a yes, placing nothing after a no, never promising profits, refusing to switch on real money) pass in ElevenLabs; re-run them from the agent's Tests tab after changing the prompt. The prompt and tool definitions are in [`agent/`](agent/).

## Files

| Path | What |
| --- | --- |
| `server.mjs` | Starts everything (`--demo`, `--port`, `--no-open`, `--data`) |
| `src/strategy/` | Indicators, features, the seven experts and the meta-learner |
| `src/risk.mjs`, `src/trader.mjs` | Position sizing, stops and limits; the portfolio decision |
| `src/backtest.mjs` | Bar-by-bar backtester, metrics, Monte Carlo |
| `src/engine.mjs` | The live loop, orders, books, events |
| `src/brokers/` | Practice account, CCXT exchanges, Alpaca |
| `src/data/` | Market data (CCXT, Alpaca, simulated) and the history cache |
| `src/tools.mjs`, `src/voice.mjs` | The voice agent's tools; ElevenLabs sessions |
| `src/app.mjs` | The local web server and its security |
| `public/` | The dashboard and the voice panel |
| `agent/` | The agent's prompt and tool definitions |
| `test/` | `npm test` (26 tests) |

## Good to know

- **Taxes:** every sale can be a taxable event where you live. Kestrel's journal (`.data/journal.jsonl`) and your exchange's statements have the details.
- **Stocks** need an Alpaca account (a free paper account works for practice prices); stock decisions wait for the US market to open.
- **Behind a proxy?** Set `HTTPS_PROXY`; on Node 22.21 or newer also set `NODE_USE_ENV_PROXY=1`.
- Settings, keys and history live in `.data/` next to this file. Delete it to start over.
