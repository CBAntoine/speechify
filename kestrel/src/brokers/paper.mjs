// Practice trading: real prices, pretend money. Fills use the live bid/ask from the data feed and
// the chosen exchange's fees, so practice results look like what real trading would have done.
// Patient orders fill at the mid price with the maker fee; urgent ones (stops, "sell now") pay
// the spread, a little slippage and the taker fee.
import { venueInfo } from "./catalog.mjs";

export const PAPER_SLIPPAGE = 0.0005;

export class PaperBroker {
  constructor({ data, venue = "kraken" }) {
    this.data = data;
    this.venue = venue;
    this.live = false;
    this.id = "paper";
    this.name = "Practice account";
  }

  fees(symbol) {
    const v = venueInfo(this.venue);
    if (!String(symbol).includes("/") && v.stockFees) return v.stockFees;
    return v.fees;
  }

  async marketOpen() {
    return true;
  }

  /** @returns {symbol, side, qty, price, fee, maker, t} */
  async execute({ symbol, side, qty, notional, patient = true, venue = this.venue }) {
    const px = await this.data.price(venue, symbol);
    const fees = this.fees(symbol);
    const maker = !!patient;
    const mid = (px.bid + px.ask) / 2 || px.last;
    const price = maker ? mid : side === "buy" ? px.ask * (1 + PAPER_SLIPPAGE) : px.bid * (1 - PAPER_SLIPPAGE);
    const rate = maker ? fees.maker : fees.taker;
    let q = qty;
    if (side === "buy") q = notional / price;
    if (!(q > 0)) throw new Error("Nothing to trade.");
    const fee = q * price * rate;
    return { symbol, side, qty: q, price, fee, maker, t: Date.now(), orderId: `paper-${Date.now().toString(36)}` };
  }
}
