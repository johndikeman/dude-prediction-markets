# dude-prediction-markets

A self-improving AI agent fork of `dude` for prediction market analysis and automated betting research.

## Overview

This agent specializes in:
- Aggregating news and data relevant to prediction markets
- Sourcing market data from prediction market platforms
- Formatting contextual information for agent decision-making
- Providing structured intelligence for betting strategies

## Tech Stack
- **pi-mono-agent**: The underlying coding agent.
- **Node.js**: For the data sourcing utilities.
- **Nix Flakes**: For dependency management.
- **Discord.js**: For communication with the user.

## Setup
1. Clone this repository on your VPS.
2. Run `nix develop` or use the systemd service.
3. Configure your `.env` file with required API keys.
4. Start the agent: `npm start`

## Project Structure
- `src/markets/`: Prediction market data sourcing and formatting
- `src/sources/`: Individual news and data source implementations
- `src/formatters/`: Context formatters for agent consumption
- `docs/`: Research documentation and API references

## Discord Commands
- `/markets-status`: Shows current data sourcing status
- `/markets-refresh`: Triggers a manual refresh of all data sources
- Standard dude agent commands (`/task`, `/start`, `/status`, etc.)

## Data Sources
See `docs/RESEARCH.md` for details on supported news sources and prediction market APIs.
