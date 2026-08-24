/**
 * Google News RSS source
 * Fetches news via Google News RSS feeds for any search query
 * No API key required
 */

import { fetch } from "undici";

export class GoogleNewsRssSource {
  constructor(options = {}) {
    this.name = "google-news-rss";
    this.language = options.language || "en";
    this.country = options.country || "US";
  }

  async fetchByQuery(query, limit = 20) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${this.language}&gl=${this.country}&ceid=${this.country}:${this.language}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; dude-prediction-markets/0.1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`Google News RSS HTTP ${response.status}`);
      }

      const xml = await response.text();
      return this.parseRss(xml, limit);
    } catch (err) {
      return { source: this.name, error: err.message, items: [] };
    }
  }

  parseRss(xml, limit) {
    const items = [];
    const itemRegex = /<item>[\s\S]*?<\/item>/g;
    const titleRegex = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
    const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;

    const matches = xml.match(itemRegex) || [];

    for (let i = 0; i < Math.min(matches.length, limit); i++) {
      const itemXml = matches[i];
      const titleMatch = itemXml.match(titleRegex);
      const linkMatch = itemXml.match(linkRegex);
      const pubDateMatch = itemXml.match(pubDateRegex);
      const descMatch = itemXml.match(descRegex);

      if (titleMatch) {
        items.push({
          title: this.cleanXmlText(titleMatch[1]),
          url: linkMatch ? this.cleanXmlText(linkMatch[1]) : "",
          summary: descMatch ? this.cleanXmlText(descMatch[1]).replace(/<[^>]+>/g, " ").trim() : "",
          publishedAt: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString(),
          source: this.name,
        });
      }
    }

    return { source: this.name, items };
  }

  cleanXmlText(text) {
    if (!text) return "";
    return text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
}
