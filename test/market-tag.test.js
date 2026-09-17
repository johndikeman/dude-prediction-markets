import { test } from "node:test";
import assert from "node:assert";
import { PolymarketSource } from "../src/sources/polymarket.js";

// regression tests for the tech-ai blind-strategy bug (2026-09-17):
// gamma-api silently ignores the `tag=<slug>` param — only `tag_id=<numeric>`
// filters. the tech-ai strategy went fully blind (0 marketItems) when the
// purpose cycle dropped metaculus from its marketSources, because polymarket's
// volume-ordered top feed contains no AI markets and the local relevance
// filter kept 0 items.

function mockFetch(entries) {
  return async (url) => {
    entries.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => [],
    };
  };
}

test("PolymarketSource fetchActiveMarkets uses tag_id for numeric tags", async () => {
  const urls = [];
  const source = new PolymarketSource();
  source._fetch = mockFetch(urls);

  await source.fetchActiveMarkets(50, "439");

  assert.strictEqual(urls.length, 1);
  assert.ok(urls[0].includes("tag_id=439"), `expected tag_id=439 in ${urls[0]}`);
  assert.ok(!urls[0].includes("tag=439&") && !urls[0].endsWith("tag=439"));
});

test("PolymarketSource fetchActiveMarkets no tag param when tag is null", async () => {
  const urls = [];
  const source = new PolymarketSource();
  source._fetch = mockFetch(urls);

  await source.fetchActiveMarkets(50, null);

  assert.strictEqual(urls.length, 1);
  assert.ok(!urls[0].includes("tag"), `expected no tag in ${urls[0]}`);
});

test("DataSourcer fetchMarkets forwards options.tag to polymarket", async () => {
  const { DataSourcer } = await import("../src/markets/data-sourcer.js");
  const seen = {};
  const sourcer = new DataSourcer({ enabledSources: ["polymarket"] });
  const pm = sourcer.sources.get("polymarket");
  pm.fetchActiveMarkets = async (limit, tag) => {
    seen.limit = limit;
    seen.tag = tag;
    return { source: "polymarket", items: [] };
  };

  await sourcer.fetchMarkets({ limit: 10, tag: "439", search: "ai" });
  assert.strictEqual(seen.tag, "439");
  // pool is limit*4 per the local-relevance-filter design
  assert.strictEqual(seen.limit, 40);
});
