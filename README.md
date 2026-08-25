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
| GDELT | Events | None |
| Reddit | Sentiment | None (rate limited) |

## Obsidian Reports
Each run cycle produces a new markdown report in `vault/reports/prediction-markets/` and appends a link to `betting market project.md`.
