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
