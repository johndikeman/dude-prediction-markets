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
  }

  async fetchRecentEvents(query = "", limit = 50) {
    try {
      // GDELT's knowledge graph endpoint with query
      const url = `${this.baseUrl}/gkg_geojson?query=${encodeURIComponent(query)}&format=json&limit=${limit}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
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
      return { source: this.name, error: err.message, items: [] };
    }
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
