import { test } from "node:test";
import assert from "node:assert";
import { ContextFormatter } from "../src/markets/formatter.js";

test("formatter produces report with news and markets", () => {
  const formatter = new ContextFormatter();
  const data = {
    query: "us election 2024",
    timestamp: "2026-08-24T22:00:00Z",
    news: [
      {
        source: "google-news-rss",
        items: [
          {
            title: "Polls Show Tight Race",
            url: "https://example.com/polls",
            summary: "Latest polling data indicates a very close race.",
            publishedAt: "2026-08-24T20:00:00Z",
            source: "google-news-rss",
          },
        ],
      },
    ],
    markets: [
      {
        source: "polymarket",
        items: [
          {
            title: "Candidate A wins election?",
            url: "https://polymarket.com/event/election",
            volume: 1500000,
            liquidity: 450000,
            outcomes: [
              { name: "Yes", probability: 0.52 },
              { name: "No", probability: 0.48 },
            ],
          },
        ],
      },
    ],
  };

  const output = formatter.format(data);
  assert.ok(output.includes("Market Intelligence Report"));
  assert.ok(output.includes("us election 2024"));
  assert.ok(output.includes("Polls Show Tight Race"));
  assert.ok(output.includes("Candidate A wins election?"));
  assert.ok(output.includes("$1.5M vol"));
  assert.ok(output.includes("Yes: 52%"));
});

test("formatter handles missing data gracefully", () => {
  const formatter = new ContextFormatter();
  const data = {
    query: "crypto",
    timestamp: "2026-08-24T22:00:00Z",
    news: [],
    markets: [],
  };

  const output = formatter.format(data);
  assert.ok(output.includes("No news data available"));
  assert.ok(output.includes("No market data available"));
});

test("formatter handles source errors", () => {
  const formatter = new ContextFormatter();
  const data = {
    query: "tech",
    timestamp: "2026-08-24T22:00:00Z",
    news: [{ source: "gdelt", error: "timeout", items: [] }],
    markets: [{ source: "polymarket", error: "rate limited", items: [] }],
  };

  const output = formatter.format(data);
  assert.ok(output.includes("gdelt: ⚠️ error"));
  assert.ok(output.includes("polymarket: ⚠️ error"));
});

test("formatter respects max items limits", () => {
  const formatter = new ContextFormatter({ maxNewsItems: 2, maxMarketItems: 1 });
  const data = {
    query: "sports",
    timestamp: "2026-08-24T22:00:00Z",
    news: [
      {
        source: "google-news-rss",
        items: [
          { title: "News 1", source: "google-news-rss" },
          { title: "News 2", source: "google-news-rss" },
          { title: "News 3", source: "google-news-rss" },
        ],
      },
    ],
    markets: [
      {
        source: "metaculus",
        items: [
          { title: "Market 1" },
          { title: "Market 2" },
        ],
      },
    ],
  };

  const output = formatter.format(data);
  const newsMatches = output.match(/News \d/g);
  const marketMatches = output.match(/Market \d/g);
  assert.strictEqual(newsMatches.length, 2);
  assert.strictEqual(marketMatches.length, 1);
});

test("formatter formats metaculus items correctly", () => {
  const formatter = new ContextFormatter();
  const data = {
    query: "ai",
    timestamp: "2026-08-24T22:00:00Z",
    news: [],
    markets: [
      {
        source: "metaculus",
        items: [
          {
            title: "AGI by 2030?",
            url: "https://metaculus.com/questions/1234",
            communityPrediction: 0.35,
            numForecasters: 1200,
          },
        ],
      },
    ],
  };

  const output = formatter.format(data);
  assert.ok(output.includes("AGI by 2030?"));
  assert.ok(output.includes("community: 35%"));
  assert.ok(output.includes("1200 forecasters"));
});
