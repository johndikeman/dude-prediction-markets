/**
 * Polymarket data source
 * Fetches market data from Polymarket's public API
 * No API key required for read-only market data
 */

import { fetch } from "undici";

export class PolymarketSource {
  constructor(options = {}) {
    this.name = "polymarket";
    this.baseUrl = options.baseUrl || "https://gamma-api.polymarket.com";
  }

  async fetchActiveMarkets(limit = 20, tag = null) {
    try {
      let url = `${this.baseUrl}/events?closed=false&limit=${limit}&order=volume&sort=-volume`;
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
    if (event.markets && Array.isArray(event.markets)) {
      for (const m of event.markets) {
        outcomes.push({
          name: m.outcomePrices ? Object.keys(m.outcomePrices)[0] : m.question || "",
          probability: m.outcomePrices ? parseFloat(Object.values(m.outcomePrices)[0]) : null,
          volume: m.volume || 0,
          liquidity: m.liquidity || 0,
        });
      }
    }

    return {
      id: event.id || event.slug || "",
      title: event.title || event.question || "Unknown Market",
      url: event.slug ? `https://polymarket.com/event/${event.slug}` : "",
      description: event.description || "",
      category: event.tags && Array.isArray(event.tags) ? event.tags.map(t => t.label || t.slug) : [],
      volume: event.volume || 0,
      liquidity: event.liquidity || 0,
      resolutionDate: event.endDate || event.resolutionDate || null,
      outcomes,
      source: this.name,
      updatedAt: new Date().toISOString(),
    };
  }
}
