/**
 * GDELT Project data source
 * Fetches global event data from GDELT's public feeds
 * No API key required
 */

import { fetch } from "undici";

const GDELT_LAST_UPDATE_URL = "https://api.gdeltproject.org/api/v1/gkg_geojson";
const GDELT_JSON_URL = "https://api.gdeltproject.org/api/v1/gkg_geojson?query=&format=json";

export class GdeltSource {
  constructor(options = {}) {
    this.name = "gdelt";
    this.baseUrl = options.baseUrl || "https://api.gdeltproject.org/api/v1";
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetchRecentEvents(query = "", limit = 50) {
    const url = `${this.baseUrl}/gkg_geojson?query=${encodeURIComponent(query)}&format=json&limit=${limit}`;
    const maxAttempts = this.maxAttempts;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.fetchFn(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            "User-Agent": "dude-prediction-markets/0.1.0",
          },
        });

        if (!response.ok) {
          throw new Error(`GDELT HTTP ${response.status}`);
        }

        const data = await response.json();
        return this.normalize(data);
      } catch (err) {
        lastErr = err;
        // only retry on transient-looking failures (network/timeout/5xx)
        const statusMatch = /GDELT HTTP (\d+)/.exec(err.message);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        const transient = !status || status >= 500;
        if (attempt < maxAttempts && transient) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
          continue;
        }
        return { source: this.name, error: err.message, items: [] };
      }
    }
    return { source: this.name, error: lastErr?.message || "unknown", items: [] };
  }

  normalize(data) {
    const items = [];
    if (data && Array.isArray(data.features)) {
      for (const feature of data.features.slice(0, 50)) {
        const props = feature.properties || {};
        items.push({
          title: props.name || "GDELT Event",
          url: props.url || "",
          summary: props.tone || "",
          publishedAt: props.date ? this.parseGdeltDate(props.date) : new Date().toISOString(),
          source: this.name,
          topics: props.themes ? props.themes.split(";") : [],
          locations: props.locations ? props.locations.split(";") : [],
        });
      }
    }
    return { source: this.name, items };
  }

  parseGdeltDate(dateStr) {
    // GDELT dates are often YYYYMMDDHHMMSS
    if (!dateStr || dateStr.length < 8) return new Date().toISOString();
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = dateStr.slice(8, 10) || "00";
    const minute = dateStr.slice(10, 12) || "00";
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`).toISOString();
  }
}
