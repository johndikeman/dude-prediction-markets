/**
 * Polymarket data source
 * Fetches market data from Polymarket's public API
 * No API key required for read-only market data
 */

import { fetch } from "undici";

/**
 * gamma-api returns several fields as JSON-encoded strings
 * (e.g. outcomePrices: "[\"0.1\", \"0.9\"]"). Parse them when needed.
 */
export function parseJsonMaybe(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Extract (name, probability) pairs for a single gamma market.
 * Returns [] when prices are missing/unparseable.
 */
export function extractOutcomes(m) {
  const outcomes = parseJsonMaybe(m.outcomes);
  const prices = parseJsonMaybe(m.outcomePrices);
  const names = Array.isArray(outcomes)
    ? outcomes
    : outcomes && typeof outcomes === "object"
      ? Object.values(outcomes)
      : null;
  const vals = Array.isArray(prices)
    ? prices
    : prices && typeof prices === "object"
      ? Object.values(prices)
      : null;
  if (!names || !vals) return [];
  const out = [];
  for (let i = 0; i < Math.min(names.length, vals.length); i++) {
    const p = parseFloat(vals[i]);
    if (Number.isNaN(p)) continue;
    out.push({ name: String(names[i]), probability: p });
  }
  return out;
}

export class PolymarketSource {
  constructor(options = {}) {
    this.name = "polymarket";
    this.baseUrl = options.baseUrl || "https://gamma-api.polymarket.com";
  }

  async fetchActiveMarkets(limit = 20, tag = null) {
    try {
      // note: the /events endpoint ignores a "sort" param; use order+ascending
      let url = `${this.baseUrl}/events?closed=false&limit=${limit}&order=volume24hr&ascending=false`;
      if (tag) {
        url += `&tag=${encodeURIComponent(tag)}`;
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent": "dude-prediction-markets/0.1.0",
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Polymarket HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.normalizeMarkets(data);
    } catch (err) {
      return { source: this.name, error: err.message, items: [] };
    }
  }

  async fetchMarketById(marketId) {
    try {
      const url = `${this.baseUrl}/events/${marketId}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "dude-prediction-markets/0.1.0",
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Polymarket HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.normalizeMarket(data);
    } catch (err) {
      return { source: this.name, error: err.message, item: null };
    }
  }

  normalizeMarkets(data) {
    const items = [];
    if (!Array.isArray(data)) {
      return { source: this.name, items };
    }

    for (const event of data.slice(0, 50)) {
      const market = this.normalizeMarket(event);
      if (market) items.push(market);
    }

    return { source: this.name, items };
  }

  normalizeMarket(event) {
    if (!event) return null;

    const outcomes = [];
    let probability = null;
    let probabilityMarket = null;
    let bestVolume = -1;
    let totalVolume = 0;
    if (event.markets && Array.isArray(event.markets)) {
      for (const m of event.markets) {
        const parsed = extractOutcomes(m);
        // per-market volume/liquidity are strings on gamma-api
        const mVolume = parseFloat(m.volumeNum ?? m.volume) || 0;
        const mLiquidity = parseFloat(m.liquidityNum ?? m.liquidity) || 0;
        for (const o of parsed) {
          outcomes.push({
            name: o.name,
            probability: o.probability,
            volume: mVolume,
            liquidity: mLiquidity,
          });
        }
        totalVolume += mVolume;
        // top-level "probability" = the Yes/first outcome of the highest-volume
        // market in the event, so snapshots and signal research get a price
        if (parsed.length > 0 && mVolume > bestVolume) {
          bestVolume = mVolume;
          probabilityMarket = m.question || "";
          const yesOutcome = parsed.find((o) => o.name.toLowerCase() === "yes");
          probability = yesOutcome ? yesOutcome.probability : parsed[0].probability;
        }
      }
    }

    return {
      id: event.id || event.slug || "",
      title: event.title || event.question || "Unknown Market",
      url: event.slug ? `https://polymarket.com/event/${event.slug}` : "",
      description: event.description || "",
      category: event.tags && Array.isArray(event.tags) ? event.tags.map(t => t.label || t.slug) : [],
      probability,
      probabilityMarket,
      volume: totalVolume || parseFloat(event.volume) || 0,
      volume24h: parseFloat(event.volume24hr) || 0,
      totalVolume: totalVolume || parseFloat(event.volume) || 0,
      liquidity: parseFloat(event.liquidity) || 0,
      closeDate: event.endDate || null,
      resolutionDate: event.endDate || event.resolutionDate || null,
      outcomes,
      source: this.name,
      updatedAt: new Date().toISOString(),
    };
  }
}
