/**
 * DataSourcer - coordinates multiple news and prediction market sources
 * and formats the output for agent consumption.
 */

import { GdeltSource } from "../sources/gdelt.js";
import { GoogleNewsRssSource } from "../sources/google-news-rss.js";
import { PolymarketSource } from "../sources/polymarket.js";
import { MetaculusSource } from "../sources/metaculus.js";
import { ManifoldSource } from "../sources/manifold.js";
import { RedditSource } from "../sources/reddit.js";

// after this many consecutive failures, a source is put into cooldown
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

export class DataSourcer {
  constructor(options = {}) {
    this.sources = new Map();
    // circuit-breaker state: name -> { failures, lastError, disabledUntil }
    this.health = new Map();
    this.failureThreshold = options.failureThreshold ?? FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
    this.enabledSources = options.enabledSources || [
      "gdelt",
      "google-news-rss",
      "polymarket",
      "metaculus",
      "manifold",
      "reddit",
    ];
    this.initializeSources(options);
  }

  initializeSources(options) {
    if (this.enabledSources.includes("gdelt")) {
      this.sources.set("gdelt", new GdeltSource(options.gdelt));
    }
    if (this.enabledSources.includes("google-news-rss")) {
      this.sources.set("google-news-rss", new GoogleNewsRssSource(options.googleNews));
    }
    if (this.enabledSources.includes("polymarket")) {
      this.sources.set("polymarket", new PolymarketSource(options.polymarket));
    }
    if (this.enabledSources.includes("metaculus")) {
      this.sources.set("metaculus", new MetaculusSource({
        ...options.metaculus,
        apiKey: process.env.METACULUS_API_KEY,
      }));
    }
    if (this.enabledSources.includes("manifold")) {
      this.sources.set("manifold", new ManifoldSource(options.manifold));
    }
    if (this.enabledSources.includes("reddit")) {
      this.sources.set("reddit", new RedditSource(options.reddit));
    }
  }

  /**
   * Circuit breaker: skip a source while it's in cooldown and record
   * success/failure based on its result object (`error` field = failure).
   * Sources already degrade gracefully ({source, error, items: []}), so we
   * just track that instead of forcing a throw/catch contract.
   */
  isCoolingDown(name) {
    const h = this.health.get(name);
    return !!h && h.disabledUntil && Date.now() < h.disabledUntil;
  }

  recordResult(name, result) {
    const h = this.health.get(name) || { failures: 0, lastError: null, disabledUntil: null };
    if (result?.error) {
      h.failures += 1;
      h.lastError = result.error;
      if (h.failures >= this.failureThreshold) {
        h.disabledUntil = Date.now() + this.cooldownMs;
      }
    } else {
      h.failures = 0;
      h.lastError = null;
      h.disabledUntil = null;
    }
    this.health.set(name, h);
  }

  async guardedFetch(name, fn) {
    if (this.isCoolingDown(name)) {
      const h = this.health.get(name);
      return { source: name, skipped: true, error: h.lastError, items: [] };
    }
    const result = await fn();
    this.recordResult(name, result);
    return result;
  }

  async fetchNews(query, options = {}) {
    const limit = options.limit || 20;
    const results = [];

    // Google News RSS for keyword search
    if (this.sources.has("google-news-rss")) {
      const gn = this.sources.get("google-news-rss");
      results.push(await this.guardedFetch("google-news-rss", () =>
        gn.fetchByQuery(query, limit)
      ));
    }

    // GDELT for global events matching query
    if (this.sources.has("gdelt")) {
      const gdelt = this.sources.get("gdelt");
      results.push(await this.guardedFetch("gdelt", () =>
        gdelt.fetchRecentEvents(query, limit)
      ));
    }

    // Reddit for community sentiment
    if (this.sources.has("reddit")) {
      const reddit = this.sources.get("reddit");
      // Search relevant subreddits based on query keywords
      const subreddits = this.inferSubreddits(query);
      results.push(await this.guardedFetch("reddit", () =>
        reddit.fetchMultiSubredditPosts(subreddits, Math.min(limit, 10), "hot")
      ));
    }

    return results;
  }

  async fetchMarkets(options = {}) {
    const limit = options.limit || 20;
    const tag = options.tag || null;
    const search = options.search || "";
    const results = [];

    // Polymarket active markets
    if (this.sources.has("polymarket")) {
      const pm = this.sources.get("polymarket");
      results.push(await this.guardedFetch("polymarket", () =>
        pm.fetchActiveMarkets(limit, tag)
      ));
    }

    // Metaculus open questions
    if (this.sources.has("metaculus")) {
      const meta = this.sources.get("metaculus");
      results.push(await this.guardedFetch("metaculus", () =>
        meta.fetchQuestions(limit, "open", search)
      ));
    }

    // Manifold active markets
    if (this.sources.has("manifold")) {
      const manifold = this.sources.get("manifold");
      results.push(await this.guardedFetch("manifold", () =>
        manifold.fetchMarkets(limit)
      ));
    }

    return results;
  }

  async fetchAll(query, options = {}) {
    const [news, markets] = await Promise.all([
      this.fetchNews(query, options),
      this.fetchMarkets(options),
    ]);

    return {
      query,
      timestamp: new Date().toISOString(),
      news,
      markets,
    };
  }

  inferSubreddits(query) {
    const lower = query.toLowerCase();
    const mapping = {
      politics: ["politics", "PoliticalDiscussion", "worldnews"],
      election: ["politics", "PoliticalDiscussion", "worldnews"],
      crypto: ["cryptocurrency", "CryptoCurrency", "wallstreetbets"],
      bitcoin: ["Bitcoin", "cryptocurrency"],
      stock: ["wallstreetbets", "stocks", "investing"],
      market: ["wallstreetbets", "stocks", "investing", "Economics"],
      sport: ["sports", "nba", "nfl", "soccer"],
      "world cup": ["sports", "soccer"],
      tech: ["technology", "tech", "gadgets"],
    };

    const inferred = [];
    for (const [keyword, subs] of Object.entries(mapping)) {
      if (lower.includes(keyword)) {
        inferred.push(...subs);
      }
    }

    // Default subreddits if no match
    if (inferred.length === 0) {
      return ["worldnews", "news", "politics"];
    }

    return [...new Set(inferred)];
  }
}
