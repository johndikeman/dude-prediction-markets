/**
 * Reddit JSON API source
 * Fetches posts from subreddits via the public JSON API
 * No API key required for read-only access (rate limited)
 */

import { fetch } from "undici";

export class RedditSource {
  constructor(options = {}) {
    this.name = "reddit";
    this.baseUrl = options.baseUrl || "https://www.reddit.com";
    this.defaultSubreddits = options.defaultSubreddits || [
      "politics",
      "worldnews",
      "news",
      "wallstreetbets",
      "cryptocurrency",
    ];
  }

  async fetchSubredditPosts(subreddit, limit = 25, sort = "hot") {
    try {
      const url = `${this.baseUrl}/r/${subreddit}/${sort}.json?limit=${limit}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; dude-prediction-markets/0.1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`Reddit HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.normalizePosts(data, subreddit);
    } catch (err) {
      return { source: this.name, subreddit, error: err.message, items: [] };
    }
  }

  async fetchMultiSubredditPosts(subreddits = this.defaultSubreddits, limit = 10, sort = "hot") {
    const results = [];
    for (const sub of subreddits) {
      const result = await this.fetchSubredditPosts(sub, limit, sort);
      if (result.items && result.items.length > 0) {
        results.push(...result.items);
      }
    }
    return { source: this.name, items: results };
  }

  normalizePosts(data, subreddit) {
    const items = [];
    if (!data || !data.data || !Array.isArray(data.data.children)) {
      return { source: this.name, subreddit, items };
    }

    for (const child of data.data.children) {
      const post = child.data;
      if (!post) continue;

      items.push({
        id: post.id || "",
        title: post.title || "",
        url: post.url || `https://www.reddit.com${post.permalink || ""}`,
        summary: post.selftext ? post.selftext.slice(0, 500) : "",
        score: post.score || 0,
        numComments: post.num_comments || 0,
        upvoteRatio: post.upvote_ratio || 0,
        subreddit: post.subreddit || subreddit,
        publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString(),
        source: this.name,
      });
    }

    return { source: this.name, subreddit, items };
  }
}
