import { test } from "node:test";
import assert from "node:assert";
import { ObsidianReporter } from "../src/reports/obsidian.js";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("ObsidianReporter generates markdown with expected sections", () => {
  const reporter = new ObsidianReporter("/fake/vault");
  const markdown = reporter.generateMarkdown({
    timestamp: "2026-08-25T06:00:00Z",
    strategies: [
      { id: "s1", name: "Test Strat", status: "active", runs: 3, lastRun: "2026-08-25T05:00:00Z", query: "q1", newsSources: [], marketSources: [] },
      { id: "s2", name: "Inactive Strat", status: "inactive", runs: 0, lastRun: null, query: "q2", newsSources: [], marketSources: [] },
    ],
    snapshots: [
      { strategyId: "s1", newsCount: 5, marketsCount: 2, signals: [] },
    ],
    maintenanceActions: [
      { strategy: "s1", description: "low volume", applied: true },
    ],
  });

  assert.ok(markdown.includes("prediction market strategy report"));
  assert.ok(markdown.includes("Test Strat"));
  assert.ok(markdown.includes("inactive")); // active + inactive listed
  assert.ok(markdown.includes("s1"));
  assert.ok(markdown.includes("low volume"));
  assert.ok(markdown.includes("auto-generated"));
});

test("ObsidianReporter writes report to disk", async () => {
  const vault = join(tmpdir(), `vault-${Date.now()}`);
  await mkdir(vault, { recursive: true });
  const reporter = new ObsidianReporter(vault);

  const path = await reporter.writeReport({
    timestamp: "2026-08-25T06:00:00Z",
    strategies: [],
    snapshots: [],
    maintenanceActions: [],
  });

  assert.ok(path.includes("prediction-market-report"));
  const content = await readFile(path, "utf-8");
  assert.ok(content.includes("prediction market strategy report"));

  await rm(vault, { recursive: true, force: true });
});

test("ObsidianReporter links report into task doc", async () => {
  const vault = join(tmpdir(), `vault-${Date.now()}`);
  await mkdir(vault, { recursive: true });
  // create the task doc
  await readFile(join(vault, "betting market project.md"), "utf-8").catch(async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(vault, "betting market project.md"), "# tasks\n\n", "utf-8");
  });

  const reporter = new ObsidianReporter(vault);
  const reportPath = join(vault, "reports/prediction-markets/test-report.md");
  await reporter.linkToTaskDoc(reportPath);

  const content = await readFile(join(vault, "betting market project.md"), "utf-8");
  assert.ok(content.includes("[["));

  await rm(vault, { recursive: true, force: true });
});
