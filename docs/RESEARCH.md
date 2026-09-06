# Prediction Market Data Source Research

## News Sources for Prediction Market Context

### Free / No API Key Required
1. **Google News RSS Feeds**
   - Free RSS feeds for any search query
   - No API key needed
   - Good for keyword-based monitoring of specific events
   - Rate limited but generous for moderate usage

2. **Hacker News API** (https://github.com/HackerNews/API)
   - Good for tech-related prediction markets
   - JSON API for stories, comments, and users

4. **Reddit JSON API**
   - Access subreddits via `.json` suffix
   - No API key for read-only (but rate limited)
   - r/politics, r/news, r/worldnews useful for political markets
   - r/wallstreetbets, r/cryptocurrency for financial markets

5. **Wikipedia Current Events**
   - https://en.wikipedia.org/wiki/Portal:Current_events
   - Can be scraped for major ongoing stories
   - Useful for background context

### API Key Required (Free Tier Available)
1. **NewsAPI** (https://newsapi.org/)
   - Free tier: 100 requests/day
   - Good general news coverage
   - Simple REST API
   - Requires API key

2. **The New York Times API**
   - Free tier available
   - Good for political and US-centric markets
   - Requires API key

3. **The Guardian Open Platform**
   - Free tier: 12 calls/second, 5000 calls/day
   - Good international coverage
   - Requires API key

### Prediction Market Data APIs
1. **Polymarket**
   - Has a public API / GraphQL endpoint
   - No API key required for basic market data
   - https://polymarket.com/api
   - Good for crypto/politics/sports markets

2. **Kalshi**
   - REST API available
   - Requires API key for trading; some market data may be public
   - https://trading-api.readme.io/
   - US-regulated event contracts

3. **PredictIt** (shutting down, not recommended)
   - Was a popular political prediction market
   - API access limited

4. **Metaculus**
   - Has a public API
   - Good for forecasting questions
   - https://www.metaculus.com/api/

5. **Manifold Markets**
   - Public API available
   - Play-money markets but good signal
   - https://docs.manifold.markets/api

## Recommended Initial Implementation

For a robust, cost-effective data pipeline:
- **Primary news**: GDELT + Google News RSS (free, no keys)
- **Community sentiment**: Reddit API (free tier)
- **Market data**: Polymarket API (free, no key for read-only)
- **Structured forecasts**: Metaculus API (free)

## Permission Requirements

| Source | API Key Needed | Free Tier | Notes |
|--------|---------------|-----------|-------|
| GDELT | No | Unlimited | Best primary source |
| Google News RSS | No | Unlimited | Good for targeted queries |
| Polymarket | No | Unlimited | Read-only market data |
| Metaculus | No | Unlimited | Forecast data |
| Reddit API | No (read) | Rate limited | Use `.json` endpoints |
| NewsAPI | Yes | 100/day | Optional enhancement |
| Kalshi | Yes | Unknown | Required for US markets data |
