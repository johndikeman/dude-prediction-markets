/**
 * Metaculus data source.
 *
 * The api2 shim ignores the `search` param entirely (returns the same
 * -activity feed regardless of query) — per-strategy search results were
 * therefore identical for every strategy. /api/posts/ honors `search`, so
 * this source now queries it for the list endpoint. The /api/posts/ response
 * shape is the new one (post objects with a nested `question`); the parser
 * handles both shapes (see issue #16). API token required for all read
 * access (403 otherwise).
 */

import { fetch } from "undici";

export class MetaculusSource {
  constructor(options = {}) {
    this.name = "metaculus";
    this.baseUrl = options.baseUrl || "https://www.metaculus.com/api/posts";
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

  buildUrl() {
    // /api/posts/ honors `search`; the api2 shim silently ignores it. legacy
    // callers that still pass an api2 baseUrl keep the /questions/ path.
    const path = this.baseUrl.endsWith("/api2") ? "questions/" : "";
    return `${this.baseUrl}/${path}`;
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
      const url = `${this.buildUrl()}?${params.toString()}`;
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

  /**
   * Extract the community aggregate probability from a normalized question.
   * Handles both response shapes:
   * - legacy api2: q.community_prediction.full.q1 (a 0..1 probability)
   * - new api (api2 is now a shim over /api/posts/): nested q.question with
   *   question.aggregations.<method>.latest — binary centers[0]/means[0] are
   *   0..1 probabilities; numeric/continuous values are on the question's own
   *   scale, so only binary contributes a probability.
   * Returns null when no usable aggregate exists (metaculus currently returns
   * null aggregates sitewide — see johndikeman/dude-prediction-markets#16).
   */
  extractCommunityPrediction(q) {
    // legacy shape
    if (q.community_prediction?.full) {
      const v = q.community_prediction.full.q1;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      return null;
    }
    // new shape
    const inner = q.question;
    if (!inner || inner.type !== "binary") return null;
    const aggs = inner.aggregations || {};
    const method = inner.default_aggregation_method || "recency_weighted";
    const latest = aggs[method]?.latest || aggs.recency_weighted?.latest;
    if (!latest) return null;
    const candidates = [latest.centers, latest.means];
    for (const arr of candidates) {
      if (Array.isArray(arr) && typeof arr[0] === "number" && Number.isFinite(arr[0])) {
        return arr[0];
      }
    }
    return null;
  }

  normalize(data) {
    const items = [];
    if (!data || !Array.isArray(data.results)) {
      return { source: this.name, items };
    }

    for (const q of data.results.slice(0, 50)) {
      // new /api/posts/ shape wraps the question; notebooks have no question
      // object and no community_prediction key — skip them entirely. legacy
      // api2 results always carried a community_prediction key (even when null)
      // and are kept.
      if (q.community_prediction === undefined && !q.question) continue;

      const inner = q.question || {};
      const raw = this.extractCommunityPrediction(q);
      const communityPrediction = raw !== null ? Math.round(raw * 100) / 100 : null;

      items.push({
        id: (q.question?.id ?? q.id) || "",
        title: q.title || inner.title || "Unknown Question",
        url:
          q.page_url ||
          `https://www.metaculus.com/questions/${q.question?.id ?? q.id}/`,
        description: inner.description || q.description || "",
        category: inner.type || q.type || "",
        status: inner.status || q.status || "",
        resolutionDate:
          q.resolution_date ||
          inner.scheduled_resolve_time ||
          q.scheduled_resolve_time ||
          q.scheduled_close_date ||
          null,
        communityPrediction,
        // mirror communityPrediction into probability so the snapshot trim
        // (engine.trimRawItems) and any probability-based consumers get a price
        probability: communityPrediction,
        numForecasters: q.number_of_forecasters || q.nr_forecasters || 0,
        source: this.name,
        updatedAt: new Date().toISOString(),
      });
    }

    return { source: this.name, items };
  }
}
