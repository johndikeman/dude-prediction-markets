import { test } from "node:test";
import assert from "node:assert";
import { StrategyEngine } from "../src/strategies/engine.js";
import { mkdir, rm } from "node:fs/promises";
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
