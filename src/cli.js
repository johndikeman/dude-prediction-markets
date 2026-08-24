#!/usr/bin/env node
/**
 * CLI entry point for fetching prediction market intelligence
 * Usage: node src/cli.js <query> [options]
 */

import { DataSourcer } from "./markets/data-sourcer.js";
import { ContextFormatter } from "./markets/formatter.js";

async function main() {
  const args = process.argv.slice(2);
  const query = args[0] || "general";

  const options = {
    limit: 15,
  };

  // Parse simple flags
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === "--sources") {
      options.enabledSources = args[i + 1]?.split(",") || undefined;
      i++;
    }
  }

  console.error(`[STATUS] Fetching data for query: "${query}"...`);

  const sourcer = new DataSourcer({
    enabledSources: options.enabledSources || undefined,
  });

  const formatter = new ContextFormatter();

  try {
    const data = await sourcer.fetchAll(query, { limit: options.limit });
    const report = formatter.format(data);
    console.log(report);
  } catch (err) {
    console.error(`[ERROR] Failed to generate report: ${err.message}`);
    process.exit(1);
  }
}

main();
