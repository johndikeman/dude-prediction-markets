import { test } from "node:test";
import assert from "node:assert";
import { StrategyEngine } from "../src/strategies/engine.js";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function withTmpDir(fn) {
  const dir = join(tmpdir(), `pm-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("StrategyEngine initializes with defaults", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();

    const list = engine.list();
    assert.ok(list.length > 0, "should have default strategies");
    assert.ok(list.some((s) => s.id === "politics-elections"));
  });
});

test("StrategyEngine creates and retrieves strategies", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();

    const created = engine.create({
      id: "custom-1",
      name: "Custom",
      query: "test",
    });
    assert.strictEqual(created.id, "custom-1");
    assert.strictEqual(created.status, "active");

    const retrieved = engine.get("custom-1");
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, "Custom");

    assert.throws(() => {
      engine.create({ id: "custom-1" });
    }, /already exists/);
  });
});

test("StrategyEngine can update, activate, and deactivate", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();

    const existing = engine.list()[0];
    engine.deactivate(existing.id);
    assert.strictEqual(engine.get(existing.id).status, "inactive");
    engine.activate(existing.id);
    assert.strictEqual(engine.get(existing.id).status, "active");
  });
});

test("StrategyEngine records snapshots", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();

    const strategy = engine.list()[0];
    const data = {
      query: strategy.query,
      timestamp: new Date().toISOString(),
      news: [{ source: "test", items: [{ title: "a" }, { title: "b" }] }],
      markets: [{ source: "test", items: [{ title: "m1" }] }],
    };

    await engine.recordSnapshot(strategy.id, data, [{ type: "info", message: "ok" }]);
    const refreshed = engine.get(strategy.id);
    assert.strictEqual(refreshed.runs, 1);
    assert.strictEqual(refreshed.results.length, 1);
    assert.strictEqual(refreshed.results[0].newsCount, 2);
    assert.strictEqual(refreshed.results[0].marketsCount, 1);
  });
});

test("StrategyEngine evaluateMaintenance suggests changes on low news", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();

    const strategy = engine.list()[0];
    // Seed 3 runs with very low news to trigger maintenance
    for (let i = 0; i < 3; i++) {
      const data = {
        query: strategy.query,
        timestamp: new Date().toISOString(),
        news: [{ source: "test", items: [{ title: "a" }] }],
        markets: [],
      };
      await engine.recordSnapshot(strategy.id, data, []);
    }

    const suggestions = engine.evaluateMaintenance(strategy.id);
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.some((s) => s.type === "expand_sources"));
  });
});

test("StrategyEngine backtestSummary returns statistics", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();

    const strategy = engine.list()[0];
    const data = {
      query: strategy.query,
      timestamp: new Date().toISOString(),
      news: [{ source: "test", items: [{ title: "a" }, { title: "b" }] }],
      markets: [{ source: "test", items: [{ title: "m1" }] }],
    };

    await engine.recordSnapshot(strategy.id, data, []);
    const summary = engine.backtestSummary(strategy.id);
    assert.ok(summary);
    assert.strictEqual(summary.totalRuns, 1);
    assert.strictEqual(summary.avgNewsPerRun, 2);
    assert.strictEqual(summary.avgMarketsPerRun, 1);
  });
});

test("StrategyEngine writes raw items to snapshots.jsonl but keeps slim results", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();
    const strategy = engine.list()[0];
    const data = {
      query: strategy.query,
      timestamp: new Date().toISOString(),
      news: [
        {
          source: "test-news",
          items: [
            { title: "Big news", url: "https://x.com/1", source: "test-news", publishedAt: "2026-09-07T00:00:00Z", summary: "very long summary ".repeat(50) },
            { title: "Second", url: "https://x.com/2", source: "test-news" },
          ],
        },
      ],
      markets: [
        {
          source: "test-market",
          items: [
            { id: "m1", title: "Will X happen?", url: "https://m/1", probability: 0.42, closeDate: "2027-01-01T00:00:00Z", status: "open", source: "test-market", description: "long description ".repeat(100) },
          ],
        },
      ],
    };

    await engine.recordSnapshot(strategy.id, data, []);

    const history = JSON.parse(await readFile(join(dir, "snapshots.jsonl"), "utf-8"));
    assert.strictEqual(history.newsCount, 2);
    assert.strictEqual(history.newsItems.length, 2);
    assert.strictEqual(history.newsItems[0].title, "Big news");
    assert.ok(!("summary" in history.newsItems[0]));
    assert.strictEqual(history.marketItems.length, 1);
    assert.strictEqual(history.marketItems[0].probability, 0.42);
    assert.ok(!("description" in history.marketItems[0]));

    // in-memory results stay slim
    const slim = engine.get(strategy.id).results[0];
    assert.ok(!("newsItems" in slim));
    assert.ok(!("marketItems" in slim));

    // strategies.json stays slim too
    await engine.save();
    const saved = JSON.parse(await readFile(join(dir, "strategies.json"), "utf-8"));
    const savedResults = saved.find((s) => s.id === strategy.id).results;
    assert.ok(!("newsItems" in savedResults[0]));
  });
});

test("StrategyEngine PM_SNAPSHOT_RAW_ITEMS=false disables raw items in history", async () => {
  await withTmpDir(async (dir) => {
    process.env.PM_SNAPSHOT_RAW_ITEMS = "false";
    try {
      const engine = new StrategyEngine(dir);
      await engine.init();
      const strategy = engine.list()[0];
      const data = {
        query: strategy.query,
        timestamp: new Date().toISOString(),
        news: [{ source: "test", items: [{ title: "a" }] }],
        markets: [],
      };
      await engine.recordSnapshot(strategy.id, data, []);
      const history = JSON.parse(await readFile(join(dir, "snapshots.jsonl"), "utf-8"));
      assert.ok(!("newsItems" in history));
      assert.strictEqual(history.newsCount, 1);
    } finally {
      delete process.env.PM_SNAPSHOT_RAW_ITEMS;
    }
  });
});
