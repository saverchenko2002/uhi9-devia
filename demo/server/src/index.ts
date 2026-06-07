import cors from "cors";
import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTORS, ACTOR_IDS, type ActorId } from "./accounts.js";
import { startAnvil } from "./anvil.js";
import { usdtForWeth } from "./constants.js";
import { DEPLOYMENTS_FILE, loadDeployment, PROJECT_ROOT, runDemoDeploy, type Deployment } from "./deploy.js";
import { seedLiquidity, type PoolTarget, type SeedLiquidityResult } from "./liquidity.js";

const PORT = 8787;

function readRpcMainnet(): string {
  try {
    const env = readFileSync(resolve(PROJECT_ROOT, ".env"), "utf8");
    const match = env.match(/^RPC_MAINNET=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* optional .env */
  }
  const fromProcess = process.env.RPC_MAINNET;
  if (fromProcess) return fromProcess;
  throw new Error("RPC_MAINNET not set (project/.env or env var)");
}

let deployment: Deployment | null = null;
let oraclePriceScaled = "300000000000";
let liquiditySeeded = { hooked: false, plain: false };
let lastLiquiditySeed: SeedLiquidityResult[] = [];

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ready: deployment !== null });
});

app.post("/api/init", async (_req, res) => {
  try {
    const rpc = readRpcMainnet();
    await startAnvil(rpc);
    deployment = runDemoDeploy();
    oraclePriceScaled = deployment.oraclePriceScaled;
    liquiditySeeded = { hooked: false, plain: false };
    lastLiquiditySeed = [];
    res.json({ ok: true, deployment, oraclePriceScaled, liquiditySeeded, lastLiquiditySeed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/state", (_req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }
  res.json({ ok: true, deployment, oraclePriceScaled, liquiditySeeded, lastLiquiditySeed });
});

app.get("/api/actors", (_req, res) => {
  res.json({
    ok: true,
    actors: ACTORS.map(({ id, label, address }) => ({ id, label, address })),
  });
});

app.get("/api/liquidity/defaults", (_req, res) => {
  const wethHuman = 100;
  const priceScaled = BigInt(oraclePriceScaled);
  res.json({
    ok: true,
    wethAmount: String(wethHuman),
    usdtAmount: String(Number(usdtForWeth(wethHuman, priceScaled)) / 1e6),
  });
});

app.post("/api/liquidity/seed", async (req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }

  const { actorId, pool, wethAmount, usdtAmount } = req.body as {
    actorId?: ActorId;
    pool?: PoolTarget;
    wethAmount?: string;
    usdtAmount?: string;
  };

  if (!actorId || !ACTOR_IDS.includes(actorId)) {
    res.status(400).json({ ok: false, error: "actorId required (owner|lp|swapper|syncKeeper|plainArb)" });
    return;
  }
  if (!pool || !["hooked", "plain", "both"].includes(pool)) {
    res.status(400).json({ ok: false, error: "pool required (hooked|plain|both)" });
    return;
  }
  if (!wethAmount || !usdtAmount) {
    res.status(400).json({ ok: false, error: "wethAmount and usdtAmount required" });
    return;
  }

  try {
    console.log("[seed] POST /api/liquidity/seed", { actorId, pool, wethAmount, usdtAmount });
    const results = await seedLiquidity(deployment, { actorId, pool, wethAmount, usdtAmount });
    for (const r of results) {
      liquiditySeeded[r.pool] = true;
    }
    lastLiquiditySeed = results;
    console.log("[seed] POST /api/liquidity/seed OK", { results });
    res.json({ ok: true, results, liquiditySeeded, lastLiquiditySeed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[seed] POST /api/liquidity/seed FAILED:", message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/oracle/price", (req, res) => {
  const { priceScaled } = req.body as { priceScaled?: string };
  if (!priceScaled) {
    res.status(400).json({ ok: false, error: "priceScaled required" });
    return;
  }
  oraclePriceScaled = priceScaled;
  res.json({ ok: true, oraclePriceScaled });
});

app.listen(PORT, () => {
  console.log(`UHI9 demo API http://localhost:${PORT}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
  try {
    deployment = loadDeployment();
    console.log(`Loaded existing ${DEPLOYMENTS_FILE}`);
  } catch {
    console.log("No deployment yet — UI should POST /api/init");
  }
});
