# Folio x Chainlink — Collar Oracle CRE Workflow

Decentralized collar pricing engine powered by Chainlink CRE (Runtime Environment).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    CRE Workflow (DON)                     │
│                                                          │
│  ┌─────────────────────┐  ┌────────────────────────────┐ │
│  │ Confidential HTTP   │  │ Confidential HTTP          │ │
│  │ Chainlink Data      │  │ Yahoo Finance              │ │
│  │ Streams API         │  │ Volatility API             │ │
│  │ (HMAC creds in      │  │ (API key in enclave)       │ │
│  │  secure enclave)    │  │                            │ │
│  └────────┬────────────┘  └──────────┬─────────────────┘ │
│           │                          │                   │
│           ▼                          ▼                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           Collar Computation Engine                  │ │
│  │  price + volatility → floor (5%) + cap (15%)        │ │
│  └────────────────────────┬────────────────────────────┘ │
│                           │                              │
│                           ▼                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              EVM Write (Sepolia)                     │ │
│  │  CollarOracle.updateCollars(symbols, prices, vols)  │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│              CollarOracle Contract (Sepolia)              │
│  Stores: price, floor, cap, volatility, updatedAt        │
│  Readable by Folio frontend via /api/chainlink           │
└──────────────────────────────────────────────────────────┘
```

## Bounties

| Bounty | Prize | How |
|--------|-------|-----|
| Best CRE Workflow | $4,000 | Full workflow: Data Streams → volatility → on-chain write |
| Connect the World | $1,000 | Chainlink Data Streams for asset pricing |
| Privacy Standard | $2,000 | Confidential HTTP for Data Streams HMAC + Yahoo API key |

## Setup

### 1. Install CRE CLI

```bash
curl -sSL https://app.chain.link/cre/install.sh | bash
```

### 2. Install workflow dependencies

```bash
cd my-workflow
bun install
```

### 3. Configure secrets

```bash
cp .env.example .env
# Fill in your keys
```

### 4. Deploy CollarOracle contract

Deploy `contracts/CollarOracle.sol` to Sepolia, then update `collarOracleAddress` in config files.

### 5. Simulate (one command)

```bash
./simulate.sh
```

This starts the mock server, runs the full CRE workflow simulation, and cleans up automatically. No API keys or .env setup needed — mock values are used for offline testing.

### 6. Deploy to CRE network

```bash
cre workflow deploy folio-collar-oracle-production --target production-settings
```

## Files

```
chainlink/
├── project.yaml              # RPC endpoints for Sepolia
├── secrets.yaml              # Secret name → env var mapping
├── .env.example              # Required secrets template
├── contracts/
│   └── CollarOracle.sol      # On-chain collar storage
├── mock-server/
│   └── server.ts             # Mock Data Streams + Yahoo for simulation
└── my-workflow/
    ├── main.ts               # Entry point
    ├── workflow.ts            # Core workflow logic
    ├── workflow.yaml          # Workflow config
    ├── config.staging.json    # Staging config (testnet)
    ├── config.production.json # Production config
    ├── package.json           # Dependencies
    └── tsconfig.json          # TypeScript config
```
