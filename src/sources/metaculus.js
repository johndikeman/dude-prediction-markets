/**
 * Metaculus data source
 * Fetches forecasting questions from Metaculus public API
 * No API key required for read access
 */

import { fetch } from "undici";

export class MetaculusSource {
  constructor(options = {}) {
    this.name = "metaculus";
    this.baseUrl = options.baseUrl || "https://www.metaculus.com/api2";
    this.apiKey = options.apiKey || null;
  }

  buildHeaders() {
    // metaculus now requires authentication for all api access (403 otherwise)
    const headers = {
      "User-Agent": "dude-prediction-markets/0.1.0",
      "Accept": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Token ${this.apiKey}`;
    }
    return headers;
  }

  async fetchQuestions(limit = 20, status = "open", search = "") {
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        status,
        order_by: "-activity",
      });
      if (search) {
        params.append("search", search);
      }

      // trailing slash required — without it the api 301s and can drop auth
      const url = `${this.baseUrl}/questions/?${params.toString()}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Metaculus HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.normalize(data);
    } catch (err) {
      return { source: this.name, error: err.message, items: [] };
    }
  }

  normalize(data) {
    const items = [];
    if (!data || !Array.isArray(data.results)) {
      return { source: this.name, items };
    }

    for (const q of data.results.slice(0, 50)) {
      const communityPrediction = q.community_prediction?.full ?
        q.community_prediction.full.q1 : null;

      items.push({
        id: q.id || "",
        title: q.title || "Unknown Question",
        url: q.page_url || `https://www.metaculus.com/questions/${q.id}/`,
        description: q.description || "",
        category: q.type || "",
        status: q.status || "",
        resolutionDate: q.resolution_date || q.scheduled_close_date || null,
        communityPrediction: communityPrediction !== null ? Math.round(communityPrediction * 100) / 100 : null,
        numForecasters: q.number_of_forecasters || 0,
        source: this.name,
        updatedAt: new Date().toISOString(),
      });
    }

    return { source: this.name, items };
  }
}
