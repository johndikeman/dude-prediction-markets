/**
 * Formatter - converts raw data from sources into agent-friendly context strings
 */

export class ContextFormatter {
  constructor(options = {}) {
    this.maxNewsItems = options.maxNewsItems || 20;
    this.maxMarketItems = options.maxMarketItems || 15;
    this.maxCharsPerItem = options.maxCharsPerItem || 800;
  }

  format(dataBundle) {
    const sections = [];

    sections.push(`# Market Intelligence Report`);
    sections.push(`**Query:** ${dataBundle.query || "general"}`);
    sections.push(`**Generated:** ${dataBundle.timestamp || new Date().toISOString()}\n`);

    // News section
    sections.push(this.formatNewsSection(dataBundle.news));

    // Markets section
    sections.push(this.formatMarketsSection(dataBundle.markets));

    // Sources summary
    sections.push(this.formatSourcesSummary(dataBundle));

    return sections.join("\n");
  }

  formatNewsSection(newsResults) {
    if (!Array.isArray(newsResults) || newsResults.length === 0) {
      return `## News & Events\n_No news data available._\n`;
    }

    const lines = [`## News & Events\n`];
    let totalItems = 0;

    for (const result of newsResults) {
      if (!result || !Array.isArray(result.items)) continue;
      if (result.error) {
        lines.push(`> Warning: ${result.source} failed: ${result.error}`);
        continue;
      }

      for (const item of result.items) {
        if (totalItems >= this.maxNewsItems) break;
        lines.push(this.formatNewsItem(item));
        totalItems++;
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  formatNewsItem(item) {
    const title = (item.title || "Untitled").slice(0, 200);
    const url = item.url || "";
    let summary = (item.summary || "").slice(0, this.maxCharsPerItem);
    const date = item.publishedAt ? this.formatDate(item.publishedAt) : "";
    const source = item.source || "unknown";

    let line = `- **${title}**`;
    if (date) line += ` (${date})`;
    line += ` [${source}]`;
    if (url) line += ` <${url}>`;
    if (summary) line += `\n  ${summary.replace(/\n/g, " ")}`;

    return line;
  }

  formatMarketsSection(marketResults) {
    if (!Array.isArray(marketResults) || marketResults.length === 0) {
      return `## Prediction Markets\n_No market data available._\n`;
    }

    const lines = [`## Prediction Markets\n`];
    let totalItems = 0;

    for (const result of marketResults) {
      if (!result || !Array.isArray(result.items)) continue;
      if (result.error) {
        lines.push(`> Warning: ${result.source} failed: ${result.error}`);
        continue;
      }

      for (const item of result.items) {
        if (totalItems >= this.maxMarketItems) break;
        lines.push(this.formatMarketItem(item, result.source));
        totalItems++;
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  formatMarketItem(item, sourceName) {
    const title = (item.title || "Unknown Market").slice(0, 200);
    const url = item.url || "";

    let line = `- **${title}**`;

    if (sourceName === "polymarket") {
      const vol = item.volume ? `$${this.formatNumber(item.volume)} vol` : "";
      const liq = item.liquidity ? `$${this.formatNumber(item.liquidity)} liq` : "";
      const probs = [];
      if (item.outcomes && Array.isArray(item.outcomes)) {
        for (const o of item.outcomes) {
          if (o.probability !== null && o.probability !== undefined) {
            probs.push(`${o.name}: ${Math.round(o.probability * 100)}%`);
          }
        }
      }
      const meta = [vol, liq, ...probs].filter(Boolean).join(" | ");
      if (meta) line += `\n  ${meta}`;
    }

    if (sourceName === "metaculus") {
      const cp = item.communityPrediction !== null ? `community: ${Math.round(item.communityPrediction * 100)}%` : "";
      const forecasters = item.numForecasters ? `${item.numForecasters} forecasters` : "";
      const meta = [cp, forecasters].filter(Boolean).join(" | ");
      if (meta) line += `\n  ${meta}`;
    }

    if (sourceName === "manifold") {
      const prob = item.probability !== null && item.probability !== undefined
        ? `prob: ${Math.round(item.probability * 100)}%` : "";
      const vol = item.volume24h ? `$${this.formatNumber(item.volume24h)} 24h vol` : "";
      const meta = [prob, vol].filter(Boolean).join(" | ");
      if (meta) line += `\n  ${meta}`;
    }

    if (url) line += `\n  <${url}>`;

    return line;
  }

  formatSourcesSummary(dataBundle) {
    const lines = [`## Data Sources Summary\n`];
    const allSources = [];

    if (Array.isArray(dataBundle.news)) {
      for (const r of dataBundle.news) {
        const status = r.error ? `⚠️ error` : `✅ ${r.items?.length || 0} items`;
        allSources.push(`- ${r.source}: ${status}`);
      }
    }

    if (Array.isArray(dataBundle.markets)) {
      for (const r of dataBundle.markets) {
        const status = r.error ? `⚠️ error` : `✅ ${r.items?.length || 0} items`;
        allSources.push(`- ${r.source}: ${status}`);
      }
    }

    if (allSources.length === 0) {
      lines.push("_No sources queried._");
    } else {
      lines.push(...allSources);
    }

    lines.push("");
    return lines.join("\n");
  }

  formatDate(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  formatNumber(num) {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(Math.round(num));
  }
}
