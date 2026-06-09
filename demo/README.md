# UHI9 Demo (local simulation UI)

Single-page **local demo** — not a public dApp with wallet connect. On start it:

1. Launches **Anvil** with mainnet fork at **finalized** (or recent safe block from `RPC_MAINNET`)
2. Runs **`project/script/demo/DemoEnvironment.s.sol`** (deploy core system + hooked & plain pools)
3. Serves a **Vite + React** UI that drives actors via a small **Express + viem** API

## Layout

```
uhi9-devia/
  project/          ← Foundry contracts, .env with RPC_MAINNET
  demo/
    server/         ← API + Anvil
    web/            ← UI
    deployments.json   (generated on init)
```

## Prerequisites (WSL)

- Foundry (`forge`, `anvil`, `cast`)
- Node.js 18+ (20+ recommended)
- `RPC_MAINNET` in **`project/.env`** (same as integration tests)

## Run

```bash
# terminal 1 — API + Anvil bootstrap
cd ~/uhi9-devia/demo/server
npm install
npm run dev

# terminal 2 — UI
cd ~/uhi9-devia/demo/web
npm install
npm run dev
```

Open http://localhost:5173 — the UI calls http://localhost:8787.

Click **Launch simulation** in the browser.

## Architecture

```
Browser (React :5173)
    ↓ fetch
Express API (:8787)
    ↓ viem
Anvil fork (:8545) + contracts from project/
```

## Actors (Anvil accounts 0–4)

| Role        | Account |
|-------------|---------|
| Owner       | #0      |
| LP          | #1      |
| Swapper     | #2      |
| Feed keeper | #3      |
| Sync keeper | #4      |
| Plain arb   | #5      |
