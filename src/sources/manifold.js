/**
 * Manifold Markets data source
 * Fetches prediction markets from Manifold's public API
 * No API key required for read access
 */

import { fetch } from "undici";

export class ManifoldSource {
  constructor(options = {}) {
    this.name = "manifold";
    this.baseUrl = options.baseUrl || "https://api.manifold.markets/v0";
    this.timeoutMs = options.timeoutMs || 15000;
  }

  async fetchMarkets(limit = 20) {
    try {
      const params = new URLSearchParams({
        limit: String(Math.min(limit * 2, 500)),
        sort: "last-bet-time",
      });

      const response = await fetch(`${this.baseUrl}/markets?${params.toString()}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Manifold HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.normalize(data, limit);
    } catch (err) {
      return { source: this.name, error: err.message, items: [] };
    }
  }

  normalize(data, limit = 20) {
    const items = [];
    if (!Array.isArray(data)) {
      return { source: this.name, items };
    }

    for (const m of data) {
      if (m.isResolved || m.outcomeType === "BOUNTIES" || m.outcomeType === "FREE_RESPONSE") continue;

      items.push({
        id: m.id || "",
        title: m.question || "Unknown Market",
        url: m.url || `https://manifold.markets/${m.creatorUsername}/${m.slug || ""}`,
        description: "",
        probability: typeof m.probability === "number" ? Math.round(m.probability * 100) / 100 : null,
        volume24h: m.volume24Hours ?? null,
        totalVolume: m.volume ?? null,
        closeDate: m.closeTime ? new Date(m.closeTime).toISOString() : null,
        category: "",
        status: "open",
        source: this.name,
        updatedAt: new Date().toISOString(),
      });

      if (items.length >= limit) break;
    }

    return { source: this.name, items };
  }
}
