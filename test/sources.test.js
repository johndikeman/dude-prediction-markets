import { test } from "node:test";
import assert from "node:assert";
import { GoogleNewsRssSource } from "../src/sources/google-news-rss.js";
import { PolymarketSource, extractOutcomes } from "../src/sources/polymarket.js";
import { MetaculusSource } from "../src/sources/metaculus.js";
import { RedditSource } from "../src/sources/reddit.js";
import { ManifoldSource } from "../src/sources/manifold.js";

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
        { question: "Will it rain?", outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.7\", \"0.3\"]", volumeNum: 50000, liquidityNum: 10000 },
      ],
    },
  ];

  const result = source.normalizeMarkets(data);
  assert.strictEqual(result.source, "polymarket");
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].title, "Will it rain?");
  assert.strictEqual(result.items[0].volume, 50000);
  assert.strictEqual(result.items[0].outcomes[0].name, "Yes");
  assert.strictEqual(result.items[0].outcomes[0].probability, 0.7);
  // top-level probability = yes price of the highest-volume market
  assert.strictEqual(result.items[0].probability, 0.7);
  assert.strictEqual(result.items[0].probabilityMarket, "Will it rain?");
  assert.strictEqual(result.items[0].closeDate, "2026-09-01T00:00:00Z");
  assert.strictEqual(result.items[0].totalVolume, 50000);
});

test("PolymarketSource extractOutcomes parses stringified gamma fields", () => {
  assert.deepStrictEqual(
    extractOutcomes({ outcomes: "[\"Up\", \"Down\"]", outcomePrices: "[\"0.25\", \"0.75\"]" }),
    [
      { name: "Up", probability: 0.25 },
      { name: "Down", probability: 0.75 },
    ]
  );
  // object form (legacy) still works
  assert.deepStrictEqual(
    extractOutcomes({ outcomes: { a: "Yes" }, outcomePrices: { a: 0.4 } }),
    [{ name: "Yes", probability: 0.4 }]
  );
  // garbage strings -> no outcomes, no crash
  assert.deepStrictEqual(extractOutcomes({ outcomes: "not json", outcomePrices: "also not" }), []);
  assert.deepStrictEqual(extractOutcomes({}), []);
  // non-numeric prices are skipped
  assert.deepStrictEqual(
    extractOutcomes({ outcomes: "[\"A\", \"B\"]", outcomePrices: "[\"bad\", \"0.9\"]" }),
    [{ name: "B", probability: 0.9 }]
  );
});

test("PolymarketSource multi-market event uses highest-volume market for probability", () => {
  const source = new PolymarketSource();
  const data = [
    {
      id: "evt-2",
      title: "Big Event",
      slug: "big-event",
      volume: "999",
      volume24hr: "123",
      markets: [
        { question: "minor", outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.1\", \"0.9\"]", volumeNum: 100 },
        { question: "major", outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.8\", \"0.2\"]", volumeNum: 900 },
      ],
    },
  ];
  const item = source.normalizeMarkets(data).items[0];
  assert.strictEqual(item.probability, 0.8);
  assert.strictEqual(item.probabilityMarket, "major");
  assert.strictEqual(item.totalVolume, 1000);
  assert.strictEqual(item.volume24h, 123);
  assert.strictEqual(item.outcomes.length, 4);
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
  assert.strictEqual(result.items.length, 0); // no question object -> skipped
});

test("MetaculusSource normalize parses new api shape with binary aggregate", () => {
  const source = new MetaculusSource();
  const data = {
    results: [
      {
        id: 45500,
        title: "Fed decision in September?",
        slug: "fed-sept",
        status: "open",
        nr_forecasters: 153,
        forecasts_count: 177,
        question: {
          id: 45700,
          type: "binary",
          status: "open",
          description: "Will the Fed cut?",
          default_aggregation_method: "recency_weighted",
          scheduled_resolve_time: "2026-09-17T18:00:00Z",
          aggregations: {
            recency_weighted: {
              history: null,
              latest: { centers: [0.427], means: [0.43], forecaster_count: 153 },
              score_data: null,
              movement: null,
            },
          },
        },
      },
    ],
  };

  const result = source.normalize(data);
  assert.strictEqual(result.items.length, 1);
  const item = result.items[0];
  assert.strictEqual(item.id, 45700);
  assert.strictEqual(item.title, "Fed decision in September?");
  assert.strictEqual(item.url, "https://www.metaculus.com/questions/45700/");
  assert.strictEqual(item.probability, 0.43);
  assert.strictEqual(item.communityPrediction, 0.43);
  assert.strictEqual(item.numForecasters, 153);
  assert.strictEqual(item.resolutionDate, "2026-09-17T18:00:00Z");
});

test("MetaculusSource normalize new shape skips non-binary and null aggregates", () => {
  const source = new MetaculusSource();
  const data = {
    results: [
      {
        id: 1,
        title: "Numeric question",
        question: {
          id: 11,
          type: "numeric",
          status: "open",
          default_aggregation_method: "recency_weighted",
          aggregations: { recency_weighted: { latest: { centers: [12345.0] } } },
        },
      },
      {
        id: 2,
        title: "Binary with null aggregate",
        question: {
          id: 22,
          type: "binary",
          status: "open",
          default_aggregation_method: "recency_weighted",
          aggregations: { recency_weighted: { latest: null } },
        },
      },
      { id: 3, title: "Notebook post (no question)" },
    ],
  };

  const result = source.normalize(data);
  // numeric keeps item but null probability; null-aggregate binary keeps item;
  // notebook is skipped
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(result.items[0].probability, null);
  assert.strictEqual(result.items[0].title, "Numeric question");
  assert.strictEqual(result.items[1].probability, null);
  assert.strictEqual(result.items[1].id, 22);
});

test("MetaculusSource extractCommunityPrediction legacy still works", () => {
  const source = new MetaculusSource();
  assert.strictEqual(
    source.extractCommunityPrediction({ community_prediction: { full: { q1: 0.25 } } }),
    0.25
  );
  assert.strictEqual(source.extractCommunityPrediction({}), null);
  assert.strictEqual(
    source.extractCommunityPrediction({ community_prediction: { full: { q1: NaN } } }),
    null
  );
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
