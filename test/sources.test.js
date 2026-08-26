import { test } from "node:test";
import assert from "node:assert";
import { GdeltSource } from "../src/sources/gdelt.js";
import { GoogleNewsRssSource } from "../src/sources/google-news-rss.js";
import { PolymarketSource } from "../src/sources/polymarket.js";
import { MetaculusSource } from "../src/sources/metaculus.js";
import { RedditSource } from "../src/sources/reddit.js";
import { ManifoldSource } from "../src/sources/manifold.js";

test("GdeltSource normalize handles empty data", () => {
  const source = new GdeltSource();
  const result = source.normalize({ features: [] });
  assert.strictEqual(result.source, "gdelt");
  assert.deepStrictEqual(result.items, []);
});

test("GdeltSource normalize extracts features", () => {
  const source = new GdeltSource();
  const data = {
    features: [
      {
        properties: {
          name: "Election Update",
          url: "https://example.com/news",
          tone: "positive",
          date: "20260824203000",
          themes: "ELECTION;POLITICS",
          locations: "USA;WASHINGTON",
        },
      },
    ],
  };

  const result = source.normalize(data);
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].title, "Election Update");
  assert.strictEqual(result.items[0].url, "https://example.com/news");
  assert.deepStrictEqual(result.items[0].topics, ["ELECTION", "POLITICS"]);
});

test("GdeltSource parseGdeltDate handles various formats", () => {
  const source = new GdeltSource();
  assert.ok(source.parseGdeltDate("20260824203000").includes("2026-08-24"));
  assert.ok(source.parseGdeltDate("20260824").includes("2026-08-24"));
  assert.ok(source.parseGdeltDate("bad").includes(new Date().getFullYear()));
});

test("GoogleNewsRssSource parseRss extracts items", () => {
  const source = new GoogleNewsRssSource();
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item>
    <title><![CDATA[Breaking: Election Results]]></title>
    <link>https://example.com/election</link>
    <pubDate>Mon, 24 Aug 2026 20:00:00 GMT</pubDate>
    <description>Results are coming in.</description>
  </item>
  <item>
    <title>Second Story</title>
    <link>https://example.com/story2</link>
  </item>
</channel></rss>`;

  const result = source.parseRss(rss, 10);
  assert.strictEqual(result.source, "google-news-rss");
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(result.items[0].title, "Breaking: Election Results");
  assert.strictEqual(result.items[0].url, "https://example.com/election");
  assert.ok(result.items[0].publishedAt.includes("2026"));
});

test("GoogleNewsRssSource cleanXmlText decodes entities", () => {
  const source = new GoogleNewsRssSource();
  assert.strictEqual(source.cleanXmlText("a &lt; b &amp; c &gt; d"), "a < b & c > d");
});

test("PolymarketSource normalizeMarkets handles array", () => {
  const source = new PolymarketSource();
  const data = [
    {
      id: "evt-1",
      title: "Will it rain?",
      slug: "will-it-rain",
      description: "Weather prediction",
      tags: [{ label: "Weather", slug: "weather" }],
      volume: 50000,
      liquidity: 10000,
      endDate: "2026-09-01T00:00:00Z",
      markets: [
        { question: "Yes", outcomePrices: { Yes: 0.7 }, volume: 50000, liquidity: 10000 },
      ],
    },
  ];

  const result = source.normalizeMarkets(data);
  assert.strictEqual(result.source, "polymarket");
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].title, "Will it rain?");
  assert.strictEqual(result.items[0].volume, 50000);
  assert.strictEqual(result.items[0].outcomes[0].probability, 0.7);
});

test("PolymarketSource normalizeMarket returns null for null input", () => {
  const source = new PolymarketSource();
  assert.strictEqual(source.normalizeMarket(null), null);
});

test("MetaculusSource normalize extracts questions", () => {
  const source = new MetaculusSource();
  const data = {
    results: [
      {
        id: 1234,
        title: "AGI by 2030?",
        page_url: "https://metaculus.com/questions/1234",
        description: "Will AGI be achieved?",
        type: "binary",
        status: "open",
        resolution_date: "2030-12-31",
        community_prediction: { full: { q1: 0.25 } },
        number_of_forecasters: 800,
      },
    ],
  };

  const result = source.normalize(data);
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].title, "AGI by 2030?");
  assert.strictEqual(result.items[0].communityPrediction, 0.25);
  assert.strictEqual(result.items[0].numForecasters, 800);
});

test("MetaculusSource normalize handles missing community_prediction", () => {
  const source = new MetaculusSource();
  const data = {
    results: [
      {
        id: 5678,
        title: "Unknown forecast",
        status: "open",
      },
    ],
  };

  const result = source.normalize(data);
  assert.strictEqual(result.items[0].communityPrediction, null);
});

test("RedditSource normalizePosts extracts post data", () => {
  const source = new RedditSource();
  const data = {
    data: {
      children: [
        {
          data: {
            id: "abc123",
            title: "Important news",
            url: "https://example.com/news",
            selftext: "Details here...",
            score: 5000,
            num_comments: 200,
            upvote_ratio: 0.95,
            subreddit: "worldnews",
            created_utc: 1756579200,
          },
        },
      ],
    },
  };

  const result = source.normalizePosts(data, "worldnews");
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].title, "Important news");
  assert.strictEqual(result.items[0].score, 5000);
  assert.strictEqual(result.items[0].subreddit, "worldnews");
});

test("RedditSource normalizePosts handles empty children", () => {
  const source = new RedditSource();
  const result = source.normalizePosts({ data: { children: [] } }, "news");
  assert.strictEqual(result.items.length, 0);
});

test("ManifoldSource normalize filters resolved and extracts fields", () => {
  const source = new ManifoldSource();
  const data = [
    {
      id: "abc",
      question: "Will X happen by 2027?",
      url: "https://manifold.markets/me/will-x",
      probability: 0.234,
      volume24Hours: 1500.5,
      volume: 90000,
      closeTime: Date.parse("2027-01-01"),
      isResolved: false,
      outcomeType: "BINARY",
      creatorUsername: "me",
      slug: "will-x",
    },
    {
      id: "resolved",
      question: "Already done",
      isResolved: true,
      outcomeType: "BINARY",
    },
    {
      id: "bounty",
      question: "Bounty thing",
      outcomeType: "BOUNTIES",
    },
  ];

  const result = source.normalize(data);
  assert.strictEqual(result.source, "manifold");
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].title, "Will X happen by 2027?");
  assert.strictEqual(result.items[0].probability, 0.23);
  assert.strictEqual(result.items[0].volume24h, 1500.5);
  assert.ok(result.items[0].closeDate.includes("2027"));
});

test("ManifoldSource normalize handles non-array data", () => {
  const source = new ManifoldSource();
  const result = source.normalize(null);
  assert.deepStrictEqual(result.items, []);
});

test("MetaculusSource builds auth headers when api key present", () => {
  const withKey = new MetaculusSource({ apiKey: "test-token" });
  const headers = withKey.buildHeaders();
  assert.strictEqual(headers.Authorization, "Token test-token");

  const withoutKey = new MetaculusSource();
  assert.ok(!withoutKey.buildHeaders().Authorization);
});
