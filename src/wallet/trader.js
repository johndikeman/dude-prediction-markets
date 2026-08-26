/**
 * Trader - thin wrapper around @polymarket/clob-client for placing orders.
 *
 * Hard-gated: no orders are ever placed unless PM_TRADING_ENABLED=true.
 * Signing requires a polygon wallet private key (PM_WALLET_PRIVATE_KEY).
 * The *decision* of what to trade belongs to the agent following
 * src/prompts/cycle-instructions.md — this file only executes orders.
 */

export class Trader {
  constructor(opts = {}) {
    this.enabled = (opts.tradingEnabled ?? process.env.PM_TRADING_ENABLED) === "true";
    this.privateKey = opts.privateKey ?? process.env.PM_WALLET_PRIVATE_KEY;
    this.host = opts.host ?? "https://clob.polymarket.com";
    this.chainId = 137;
    this._client = null;
  }

  async client() {
    if (!this.enabled) throw new Error("trading disabled (set PM_TRADING_ENABLED=true)");
    if (!this.privateKey) throw new Error("PM_WALLET_PRIVATE_KEY not set");
    if (!this._client) {
      const { ClobClient } = await import("@polymarket/clob-client");
      this._client = new ClobClient(this.host, this.chainId, undefined, undefined, undefined, this.privateKey);
    }
    return this._client;
  }

  /**
   * Place a marketable limit order.
   * tokenIds come from the polymarket gamma/clob market data; price in [0.01, 0.99].
   */
  async placeOrder({ tokenId, side, price, size }) {
    if (!tokenId || !["BUY", "SELL"].includes(side)) {
      throw new Error("invalid order: need tokenId and side BUY|SELL");
    }
    if (!(price > 0.001 && price < 0.999)) throw new Error(`invalid price ${price}`);
    if (!(size >= 5)) throw new Error(`min order size is $1 (~size 5 at min tick); got ${size}`);
    const client = await this.client();
    return client.createAndPostOrder({
      tokenID: tokenId,
      price,
      side,
      size,
      feeRateBps: 0,
    });
  }

  /** Look up the clob token ids for a polymarket condition/slug. */
  async getTokenIds(conditionId) {
    const client = await this.client();
    return client.getClobTokenIds(conditionId);
  }
}
