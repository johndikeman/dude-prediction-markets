/**
 * StrategyRegistry - predefined and default strategies
 * Each strategy defines a research pipeline over a domain.
 */

export const DEFAULT_STRATEGIES = [
  {
    id: "politics-elections",
    name: "Politics & Elections",
    description: "Track political prediction markets and news sentiment.",
    query: "election politics polls debate",
    newsSources: ["google-news-rss", "gdelt", "reddit"],
    marketSources: ["polymarket", "metaculus"],
    status: "active",
  },
  {
    id: "crypto-markets",
    name: "Crypto Markets",
    description: "Track crypto regulation, ETF, and price-related markets.",
    query: "cryptocurrency bitcoin ETF regulation",
    newsSources: ["google-news-rss", "reddit"],
    marketSources: ["polymarket", "metaculus"],
    status: "active",
  },
  {
    id: "tech-ai",
    name: "Tech & AI",
    description: "Track AGI, AI regulation, and tech prediction markets.",
    query: "artificial intelligence AGI regulation tech",
    newsSources: ["google-news-rss", "reddit"],
    marketSources: ["polymarket", "metaculus"],
    status: "active",
  },
  {
    id: "sports-global",
    name: "Sports & Global Events",
    description: "Track major sporting events and global competition markets.",
    query: "world cup olympics sports betting",
    newsSources: ["google-news-rss", "gdelt", "reddit"],
    marketSources: ["polymarket", "metaculus"],
    status: "active",
  },
  {
    id: "macroeconomics",
    name: "Macroeconomics",
    description: "Track interest rates, inflation, recession indicators.",
    query: "recession inflation interest rate economy",
    newsSources: ["google-news-rss", "gdelt", "reddit"],
    marketSources: ["polymarket", "metaculus"],
    status: "active",
  },
];
