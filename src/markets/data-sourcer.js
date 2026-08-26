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

export class DataSourcer {
  constructor(options = {}) {
    this.sources = new Map();
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

  async fetchNews(query, options = {}) {
    const limit = options.limit || 20;
    const results = [];

    // Google News RSS for keyword search
    if (this.sources.has("google-news-rss")) {
      const gn = this.sources.get("google-news-rss");
      results.push(await gn.fetchByQuery(query, limit));
    }

    // GDELT for global events matching query
    if (this.sources.has("gdelt")) {
      const gdelt = this.sources.get("gdelt");
      results.push(await gdelt.fetchRecentEvents(query, limit));
    }

    // Reddit for community sentiment
    if (this.sources.has("reddit")) {
      const reddit = this.sources.get("reddit");
      // Search relevant subreddits based on query keywords
      const subreddits = this.inferSubreddits(query);
      results.push(await reddit.fetchMultiSubredditPosts(subreddits, Math.min(limit, 10), "hot"));
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
      results.push(await pm.fetchActiveMarkets(limit, tag));
    }

    // Metaculus open questions
    if (this.sources.has("metaculus")) {
      const meta = this.sources.get("metaculus");
      results.push(await meta.fetchQuestions(limit, "open", search));
    }

    // Manifold active markets
    if (this.sources.has("manifold")) {
      const manifold = this.sources.get("manifold");
      results.push(await manifold.fetchMarkets(limit));
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
