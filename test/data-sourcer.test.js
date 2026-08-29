import { test } from "node:test";
import assert from "node:assert";
import { DataSourcer } from "../src/markets/data-sourcer.js";

test("DataSourcer initializes with default sources", () => {
  const sourcer = new DataSourcer();
  assert.ok(sourcer.sources.has("gdelt"));
  assert.ok(sourcer.sources.has("google-news-rss"));
  assert.ok(sourcer.sources.has("polymarket"));
  assert.ok(sourcer.sources.has("metaculus"));
  assert.ok(sourcer.sources.has("reddit"));
});

test("DataSourcer initializes with subset of sources", () => {
  const sourcer = new DataSourcer({ enabledSources: ["polymarket", "metaculus"] });
  assert.ok(sourcer.sources.has("polymarket"));
  assert.ok(sourcer.sources.has("metaculus"));
  assert.ok(!sourcer.sources.has("gdelt"));
});

test("DataSourcer inferSubreddits maps keywords correctly", () => {
  const sourcer = new DataSourcer();

  const politics = sourcer.inferSubreddits("US election results");
  assert.ok(politics.includes("politics"));

  const crypto = sourcer.inferSubreddits("bitcoin price prediction");
  assert.ok(crypto.includes("cryptocurrency"));

  const sports = sourcer.inferSubreddits("sports betting odds");
  assert.ok(sports.includes("sports"));

  const defaultSubs = sourcer.inferSubreddits("random topic");
  assert.ok(defaultSubs.includes("worldnews"));
});

test("DataSourcer fetchAll returns structured result", async () => {
  const sourcer = new DataSourcer({ enabledSources: [] });
  const result = await sourcer.fetchAll("test query");

  assert.strictEqual(result.query, "test query");
  assert.ok(result.timestamp);
  assert.ok(Array.isArray(result.news));
  assert.ok(Array.isArray(result.markets));
});

test("circuit breaker: healthy source is called and recorded as success", async () => {
  const sourcer = new DataSourcer({ enabledSources: [] });
  const result = await sourcer.guardedFetch("gdelt", async () => ({ source: "gdelt", items: [{}] }));
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(sourcer.health.get("gdelt").failures, 0);
  assert.ok(!sourcer.isCoolingDown("gdelt"));
});

test("circuit breaker: consecutive failures trigger cooldown after threshold", async () => {
  const sourcer = new DataSourcer({ enabledSources: [], failureThreshold: 3, cooldownMs: 1000 });
  const failing = async () => ({ source: "gdelt", error: "GDELT HTTP 503", items: [] });

  await sourcer.guardedFetch("gdelt", failing);
  await sourcer.guardedFetch("gdelt", failing);
  assert.ok(!sourcer.isCoolingDown("gdelt")); // under threshold

  await sourcer.guardedFetch("gdelt", failing);
  assert.ok(sourcer.isCoolingDown("gdelt"));
  assert.strictEqual(sourcer.health.get("gdelt").failures, 3);
});

test("circuit breaker: source in cooldown is skipped without calling it", async () => {
  const sourcer = new DataSourcer({ enabledSources: [], failureThreshold: 1, cooldownMs: 60000 });
  await sourcer.guardedFetch("gdelt", async () => ({ source: "gdelt", error: "fetch failed", items: [] }));
  assert.ok(sourcer.isCoolingDown("gdelt"));

  let called = 0;
  const result = await sourcer.guardedFetch("gdelt", async () => { called++; return { source: "gdelt", items: [] }; });
  assert.strictEqual(called, 0);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.error, "fetch failed");
});

test("circuit breaker: success resets failure state", async () => {
  const sourcer = new DataSourcer({ enabledSources: [], failureThreshold: 2, cooldownMs: 60000 });
  const failing = async () => ({ source: "gdelt", error: "boom", items: [] });
  await sourcer.guardedFetch("gdelt", failing);
  await sourcer.guardedFetch("gdelt", async () => ({ source: "gdelt", items: [{}] }));
  assert.ok(!sourcer.isCoolingDown("gdelt"));
  assert.strictEqual(sourcer.health.get("gdelt").failures, 0);

  await sourcer.guardedFetch("gdelt", failing);
  assert.ok(!sourcer.isCoolingDown("gdelt")); // reset back to 1
});
