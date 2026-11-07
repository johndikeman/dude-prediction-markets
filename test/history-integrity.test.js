import { test } from "node:test";
import assert from "node:assert";
import { StrategyEngine, parseHistoryBuffer } from "../src/strategies/engine.js";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function withTmpDir(fn) {
  const dir = join(tmpdir(), `pm-hist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const a = { strategyId: "x", timestamp: "2026-11-06T06:00:00Z", n: 1 };
const b = { strategyId: "y", timestamp: "2026-11-06T18:00:00Z", n: 2 };

test("parseHistoryBuffer parses healthy jsonl", () => {
  const raw = JSON.stringify(a) + "\n" + JSON.stringify(b) + "\n";
  const { entries, corruptedLines, truncatedTail } = parseHistoryBuffer(raw);
  assert.deepStrictEqual(entries, [a, b]);
  assert.strictEqual(corruptedLines, 0);
  assert.strictEqual(truncatedTail, false);
});

test("parseHistoryBuffer recovers concatenated entries (missing newline)", () => {
  // john's 2026-11-06 bug: entry written without trailing newline, next
  // entry concatenated onto it, plain split("\n") fails to parse
  const raw = JSON.stringify(a) + JSON.stringify(b) + "\n";
  const { entries, corruptedLines, truncatedTail } = parseHistoryBuffer(raw);
  assert.deepStrictEqual(entries, [a, b]);
  assert.strictEqual(corruptedLines, 1);
  assert.strictEqual(truncatedTail, false);
});

test("parseHistoryBuffer flags truncated tail", () => {
  const raw = JSON.stringify(a) + "\n" + JSON.stringify(b).slice(0, 20);
  const { entries, truncatedTail } = parseHistoryBuffer(raw);
  assert.deepStrictEqual(entries, [a]);
  assert.strictEqual(truncatedTail, true);
});

test("lastSnapshotFor returns entry from a corrupted (concatenated) file", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();
    const corrupted = JSON.stringify(a) + JSON.stringify({ ...b, strategyId: "macroeconomics" }) + "\n";
    await writeFile(engine.historyFile, corrupted);
    const snap = await engine.lastSnapshotFor("macroeconomics");
    assert.ok(snap, "should recover the concatenated second entry");
    assert.strictEqual(snap.strategyId, "macroeconomics");
  });
});

test("recordSnapshot auto-repairs a corrupted history file", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();
    await writeFile(engine.historyFile, JSON.stringify(a) + JSON.stringify(b) + "\n");

    await engine.recordSnapshot("politics-elections", { query: "q", news: [], markets: [] }, []);

    const raw = await readFile(engine.historyFile, "utf-8");
    const { entries, corruptedLines, truncatedTail } = parseHistoryBuffer(raw);
    assert.strictEqual(corruptedLines, 0, "file should be repaired before append");
    assert.strictEqual(truncatedTail, false);
    assert.strictEqual(entries.length, 3);
    assert.ok(raw.endsWith("\n"));
    // every line must parse standalone
    for (const line of raw.trimEnd().split("\n")) {
      assert.ok(JSON.parse(line), "each line is valid json");
    }
    // backup kept alongside
    const files = await readdirFiltered(dir);
    assert.ok(files.some((f) => f.includes(".corrupt-") && f.endsWith(".bak")), "backup exists");
  });
});

async function readdirFiltered(dir) {
  const fs = await import("node:fs/promises");
  return fs.readdir(dir);
}

test("recordSnapshot appends under lock and appends are serialized", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();
    const data = { query: "q", news: [], markets: [] };
    await Promise.all([
      engine.recordSnapshot("politics-elections", data, []),
      engine.recordSnapshot("politics-elections", data, []),
      engine.recordSnapshot("politics-elections", data, []),
    ]);
    const raw = await readFile(engine.historyFile, "utf-8");
    const { entries, corruptedLines } = parseHistoryBuffer(raw);
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(corruptedLines, 0);
    // lock dir cleaned up
    await assert.rejects(() => readFile(join(dir, "snapshots.jsonl.lock"), "utf-8"), /ENOENT/);
  });
});

test("repairHistoryFileIfCorrupt no-ops on a healthy file", async () => {
  await withTmpDir(async (dir) => {
    const engine = new StrategyEngine(dir);
    await engine.init();
    await writeFile(engine.historyFile, JSON.stringify(a) + "\n");
    const report = await engine.repairHistoryFileIfCorrupt();
    assert.strictEqual(report, null);
    const raw = await readFile(engine.historyFile, "utf-8");
    assert.deepStrictEqual(parseHistoryBuffer(raw).entries, [a]);
  });
});
