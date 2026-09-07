# dude-prediction-markets

A self-improving AI research agent for prediction market analysis and strategy tracking.

## Overview

This agent specializes in:
- Aggregating news and data relevant to prediction markets
- Sourcing market data from prediction market platforms
- Running and maintaining multiple research strategies autonomously
- Backtesting and tracking hypothetical strategy performance
- Writing structured reports to an Obsidian vault

## Goals

- **Research**: automatically discover new and active prediction markets
- **Create**: define new strategy definitions with targeted queries and sources
- **Backtest**: keep snapshots of market and news data to evaluate performance
- **Maintain**: monitor source health and reconfigure strategy parameters when needed
- **Track**: produce periodic reports explaining actions taken and current positions

## Tech Stack
- **Node.js**: For the data sourcing and strategy engine.
- **Nix Flakes**: For dependency management.

## Setup
1. Clone this repository on your VPS.
2. Run `nix develop` or use the systemd service.
3. Configure your `.env` file with optional overrides.
4. Start the agent:
   - `npm start` to run continuously.
   - `npm run run` for a single cycle (systemd mode).
   - `npm run fetch` for ad-hoc CLI queries.

## Project Structure
- `src/markets/`: Prediction market data sourcing and formatting
- `src/sources/`: Individual news and data source implementations
- `src/strategies/`: Strategy engine and predefined strategy registry
- `src/reports/`: Obsidian report generation
- `src/runner.js`: Main orchestrator
- `docs/`: Research documentation and API references

## Data Sources
| Source | Type | Auth |
|--------|------|------|
| Polymarket | Markets | None |
| Metaculus | Forecasts | None |
| Google News RSS | News | None |
| Reddit | Sentiment | None (rate limited) |

## Obsidian Reports
Each run cycle produces a new markdown report in `vault/reports/prediction-markets/` and appends a link to `betting market project.md`.

## Snapshots
Each strategy run appends a JSON line to `$PM_STATE_DIR/snapshots.jsonl`.
Besides counts and signals, the line carries trimmed raw items — news
(`title`/`url`/`source`/`publishedAt`) and markets (`title`/`url`/
`probability`/`probabilityMarket`/`closeDate`/volumes) — so paper signals and
backtests can be reconstructed from history. Polymarket items carry the
yes/first outcome price of the highest-volume market in the event as
`probability`; metaculus items mirror `communityPrediction` into
`probability`. The slim in-memory copy in
`strategies.json` (`results`, last 50) stays count-only. Set
`PM_SNAPSHOT_RAW_ITEMS=false` to disable raw-item capture.

## Autonomy / self-funding

The agent runs as a fully autonomous experiment:

- **wallet**: `src/wallet/portfolio.js` tracks a polygon/polymarket wallet
  (`PM_WALLET_ADDRESS`) — portfolio value, positions, native balance, and
  P&L history in `state/portfolio-history.json`.
- **trading**: `src/wallet/trader.js` wraps `@polymarket/clob-client` for
  order execution. hard-gated behind `PM_TRADING_ENABLED=true` +
  `PM_WALLET_PRIVATE_KEY`. decisions are made by the agent following
  `src/prompts/cycle-instructions.md`, not by brittle js logic.
- **self-recharge**: `src/tools/openrouter.js` checks credit balance each
  cycle; when below threshold, the agent converts wallet gains to credits.

## Nix

Everything required to deploy lives here:

```
nix build                 # build the package
```

Consume from another flake via:

```nix
inputs.dude-prediction-markets.url = "github:johndikeman/dude-prediction-markets";
# ...
imports = [ inputs.dude-prediction-markets.homeManagerModules.prediction-markets ];
services.prediction-markets = {
  enable = true;
  environmentFile = ./secrets/pm.env;
};
```

**important:** `pm.env` (or whatever `environmentFile` points at) must contain
`OP_SERVICE_ACCOUNT_TOKEN=<token>` in addition to any wallet/api secrets. the
service runs everything through `op run --env-file .opvars`, which resolves the
`op://` secret refs — and `op` itself can only authenticate via that token.
it cannot be baked into `.opvars` as an `op://` ref (chicken-and-egg). see
`~/.config/dude/.env` on the vps for the current token.
```

This creates namespaced `prediction-markets.service/.timer` units that do
not collide with the main dude-agent services.
