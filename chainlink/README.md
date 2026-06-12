# Folio x Chainlink — Collar Oracle CRE Workflow

Decentralized collar pricing engine powered by Chainlink CRE (Runtime Environment).

**🚀 MIGRATED TO HEDERA**: This workflow now runs fully on Hedera Testnet (EVM-compatible via HashIO).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    CRE Workflow (DON)                     │
│                                                          │
│  ┌─────────────────────┐  ┌────────────────────────────┐ │
│  │ Confidential HTTP   │  │ Confidential HTTP          │ │
│  │ Chainlink Data      │  │ DoltHub Options          │ │
│  │ Streams API         │  │ Volatility Database      │ │
│  │ (HMAC creds in      │  │ (public API)             │ │
│  │  secure enclave)    │  │                            │ │
│  └────────┬────────────┘  └──────────┬─────────────────┘ │
│           │                          │                   │
│           ▼                          ▼                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           Collar Computation Engine                  │ │
│  │  price + IV → floor (LTV) + cap (zero-cost)        │ │
│  └────────────────────────┬────────────────────────────┘ │
│                           │                              │
│                           ▼                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              EVM Write (Hedera Testnet)              │ │
│  │  CollarOracle.updateCollars(symbols, prices, vols)  │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│              CollarOracle Contract (Hedera)               │
│  Stores: price, floor, cap, volatility, updatedAt        │
│  Readable by Folio frontend via /api/chainlink           │
│  Fast finality: 3-5 seconds | Cost: ~$0.001/tx         │
└──────────────────────────────────────────────────────────┘
```

## Why Hedera?

| Feature | Base Sepolia | Hedera Testnet |
|---------|--------------|----------------|
| Finality | ~12 seconds | 3-5 seconds |
| Transaction Cost | Variable | ~$0.001 |
| Consensus | PoS | aBFT (asynchronous Byzantine Fault Tolerant) |
| Carbon Impact | Neutral | Carbon-negative |
| Token Service | ERC-20 only | Native HTS (fungible + NFT) |
| Audit Trail | Custom | Native HCS (Hedera Consensus Service) |

## Setup

### Prerequisites

1. **Hedera Testnet Account**: https://portal.hedera.com/
2. **Chainlink CRE Account**: https://cre.chain.link/
3. **Chainlink Data Streams Access**: Request testnet access

### 1. Install CRE CLI

```bash
curl -sSL https://app.chain.link/cre/install.sh | bash
```

### 2. Install workflow dependencies

```bash
cd my-workflow
bun install
```

### 3. Configure environment

```bash
cp ../.env.example .env
# Fill in your Hedera credentials and CRE keys
```

### 4. Deploy CollarOracle to Hedera

```bash
# Set environment variables
export HEDERA_TESTNET_RPC_URL=https://testnet.hashio.io/api
export CRE_ETH_PRIVATE_KEY=your_private_key_no_0x

# Deploy contracts
forge script contracts/DeployToHedera.s.sol \
  --rpc-url $HEDERA_TESTNET_RPC_URL \
  --broadcast \
  --private-key $CRE_ETH_PRIVATE_KEY
```

Update `collarOracleAddress` in `config.staging.json` and `config.production.json` with the deployed address.

### 5. Simulate locally

```bash
./simulate.sh
```

This starts the mock server and runs the full CRE workflow simulation. No API keys needed — mock values are used for offline testing.

### 6. Deploy workflow to CRE

```bash
cd my-workflow
cre workflow deploy folio-collar-oracle-production --target production-settings
```

### 7. Update forwarder address

After CRE deployment, update the forwarder in CollarOracle:

```bash
export COLLAR_ORACLE_ADDRESS=your_deployed_address
export CRE_FORWARDER_ADDRESS=address_from_cre_deployment

forge script contracts/DeployToHedera.s.sol:UpdateForwarder \
  --rpc-url $HEDERA_TESTNET_RPC_URL \
  --broadcast \
  --private-key $CRE_ETH_PRIVATE_KEY
```

## Files

```
chainlink/
├── project.yaml              # RPC endpoints for Hedera Testnet
├── secrets.yaml              # Secret name → env var mapping
├── .env.example              # Required secrets template
├── MIGRATION_GUIDE.md        # Full migration documentation
├── contracts/
│   ├── CollarOracle.sol      # On-chain collar storage
│   ├── MockUSDC.sol          # Testnet USDC mock
│   └── DeployToHedera.s.sol  # Deployment scripts
├── mock-server/
│   └── server.ts             # Mock Data Streams + DoltHub for simulation
└── my-workflow/
    ├── main.ts               # Entry point
    ├── workflow.ts           # Core workflow logic
    ├── workflow.yaml         # Workflow config
    ├── config.staging.json   # Staging config (Hedera testnet)
    ├── config.production.json# Production config (Hedera testnet)
    ├── package.json          # Dependencies
    └── tsconfig.json         # TypeScript config
```

## Network Configuration

### Hedera Testnet

- **Chain ID**: 296
- **RPC URL**: https://testnet.hashio.io/api
- **Explorer**: https://hashscan.io/testnet
- **Faucet**: https://portal.hedera.com/faucet

### Hedera Mainnet

- **Chain ID**: 295
- **RPC URL**: https://mainnet.hashio.io/api
- **Explorer**: https://hashscan.io/mainnet

## Migration from Base Sepolia

See [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) for detailed step-by-step instructions.

Key changes:
1. ✅ RPC endpoints updated to Hedera HashIO
2. ✅ Chain selector changed to `hedera-testnet`
3. ✅ Contract addresses reset (deploy new ones)
4. ✅ Frontend updated to use Hedera chain definition
5. ✅ Deployment scripts created for Hedera

## Bounties

| Bounty | Prize | How |
|--------|-------|-----|
| Best CRE Workflow | $4,000 | Full workflow: Data Streams → volatility → on-chain write |
| Connect the World | $1,000 | Chainlink Data Streams for asset pricing |
| Privacy Standard | $2,000 | Confidential HTTP for Data Streams HMAC credentials |
