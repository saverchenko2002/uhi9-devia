# UHI9 Foundry project

Solidity contracts for the dynamic fee hook, keeper coordination layer, and integration tests.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `anvil`, `cast`)
- A mainnet JSON-RPC URL ([Alchemy](https://www.alchemy.com/) or [Infura](https://infura.io/))

## Setup

```bash
cd project

# Install dependencies from foundry.toml (Soldeer)
forge soldeer install

# Configure RPC for tests and scripts
cp .env.example .env
```

Edit `.env` and set `RPC_MAINNET` to your mainnet endpoint, for example:

```env
RPC_MAINNET="https://eth-mainnet.g.alchemy.com/v2/<your-key>"
# or
RPC_MAINNET="https://mainnet.infura.io/v3/<your-key>"
```

`foundry.toml` reads this variable for the `mainnet` RPC endpoint.

## Build

```bash
forge build
```

## Test

Integration tests fork Ethereum mainnet (Uniswap v4 `PoolManager`, mainnet tokens, etc.) and require `RPC_MAINNET` in `.env`.

```bash
forge test
```

Run a subset:

## Coverage

```bash
forge coverage
```

Coverage disables the optimizer and `viaIR` by default. If you hit a `stack too deep` compiler error, use:

```bash
forge coverage --ir-minimum
```
