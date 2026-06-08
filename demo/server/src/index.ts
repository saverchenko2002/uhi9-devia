import cors from "cors";
import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { ACTORS, ACTOR_IDS, FORK_BLOCK, type ActorId } from "./accounts.js";
import { isAnvilReachable, startAnvil } from "./anvil.js";
import {
  configureDemoMining,
  getBlockState,
  markFeedSync,
  markPoolSync,
  resetBlockState,
  runBlockOperation,
  syncCurrentBlockFromChain,
} from "./blocks.js";
import { usdtForWeth } from "./constants.js";
import { DEPLOYMENTS_FILE, loadDeployment, PROJECT_ROOT, runDemoDeploy, type Deployment } from "./deploy.js";
import { previewSwapFees } from "./feePreview.js";
import {
  accumulateSwapFees,
  emptyAccumulatedFees,
  type AccumulatedFees,
} from "./accumulatedFees.js";
import { sendExecuteFeedOnly, type FeedSyncResult } from "./feed.js";
import { seedLiquidityWithHashes, type PoolTarget, type SeedLiquidityResult } from "./liquidity.js";
import { emptyPoolSnapshot, readPoolSnapshots } from "./pools.js";
import {
  executeSwapsWithHashes,
  finalizeSwapResults,
  parseSwapAmountIn,
  type SwapResult,
} from "./swap.js";
import {
  executeKeeperSync,
  finalizeKeeperSyncResult,
  previewKeeperSync,
  type SyncKeeperResult,
} from "./syncKeeper.js";
import { readSyncKeeperStatus } from "./syncKeeperStatus.js";
import { waitForAllReceipts } from "./tx.js";

const PORT = 8787;

function readEnvVar(name: string): string | undefined {
  try {
    const env = readFileSync(resolve(PROJECT_ROOT, ".env"), "utf8");
    const match = env.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* optional .env */
  }
  return process.env[name];
}

function readRpcMainnet(): string {
  const rpc = readEnvVar("RPC_MAINNET");
  if (rpc) return rpc;
  throw new Error("RPC_MAINNET not set (project/.env or env var)");
}

let deployment: Deployment | null = null;
let anvilReady = false;
let oraclePriceScaled = "300000000000";
let liquiditySeeded = { hooked: false, plain: false };
let lastLiquiditySeed: SeedLiquidityResult[] = [];
let feedEverSynced = false;
let lastFeedSync: FeedSyncResult | null = null;
let lastSwap: SwapResult[] = [];
let lastPoolSync: SyncKeeperResult | null = null;
let accumulatedFees: AccumulatedFees = emptyAccumulatedFees();

function emptyPools() {
  return { hooked: emptyPoolSnapshot("hooked"), plain: emptyPoolSnapshot("plain") };
}

async function readPoolsSafe(): Promise<ReturnType<typeof readPoolSnapshots>> {
  if (!deployment || !anvilReady || !(await isAnvilReachable())) {
    anvilReady = false;
    return emptyPools();
  }
  return readPoolSnapshots(deployment);
}

function serializeFeedSync(feed: FeedSyncResult | null) {
  if (!feed) return null;
  return {
    txHash: feed.txHash,
    priceScaled: feed.priceScaled,
    publishTime: feed.publishTime.toString(),
  };
}

async function statePayload(extra: Record<string, unknown> = {}) {
  let syncKeeperStatus = null;
  if (deployment && anvilReady && (await isAnvilReachable())) {
    try {
      syncKeeperStatus = await readSyncKeeperStatus(deployment);
    } catch {
      /* chain read optional */
    }
  }

  return {
    ok: true,
    anvilReady,
    deployment,
    oraclePriceScaled,
    liquiditySeeded,
    lastLiquiditySeed,
    lastFeedSync: serializeFeedSync(lastFeedSync),
    feedEverSynced,
    lastSwap,
    lastPoolSync,
    accumulatedFees,
    blocks: getBlockState(),
    syncKeeperStatus,
    ...extra,
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ready: deployment !== null, anvilReady, blocks: getBlockState() });
});

app.post("/api/init", async (_req, res) => {
  try {
    const rpc = readRpcMainnet();
    await startAnvil(rpc);
    anvilReady = true;
    deployment = runDemoDeploy();
    oraclePriceScaled = deployment.oraclePriceScaled;
    liquiditySeeded = { hooked: false, plain: false };
    lastLiquiditySeed = [];
    feedEverSynced = false;
    lastFeedSync = null;
    lastSwap = [];
    lastPoolSync = null;
    accumulatedFees = emptyAccumulatedFees();
    resetBlockState(deployment.forkBlock);
    await syncCurrentBlockFromChain();
    await configureDemoMining();
    const pools = await readPoolSnapshots(deployment);
    res.json(await statePayload({ pools }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/state", async (_req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }
  try {
    if (anvilReady && (await isAnvilReachable())) {
      await syncCurrentBlockFromChain();
    }
    const pools = await readPoolsSafe();
    res.json(await statePayload({ pools }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
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
    res.status(400).json({
      ok: false,
      error: "actorId required (owner|lp|swapper|syncKeeper|plainArb|feedKeeper)",
    });
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

    const pendingTxs: Hex[] = [];
    let feedSync: FeedSyncResult | null = null;
    let seedResults: SeedLiquidityResult[] = [];

    const blockNumber = await runBlockOperation(async () => {
      if (!feedEverSynced) {
        feedSync = await sendExecuteFeedOnly(deployment!, BigInt(oraclePriceScaled));
        pendingTxs.push(feedSync.txHash);
      }

      const { results, txHashes } = await seedLiquidityWithHashes(
        deployment!,
        { actorId, pool, wethAmount, usdtAmount },
        { waitReceipt: false },
      );
      pendingTxs.push(...txHashes);
      seedResults = results;
    });

    await waitForAllReceipts(pendingTxs);

    if (feedSync) {
      feedEverSynced = true;
      lastFeedSync = feedSync;
      markFeedSync(blockNumber);
    }
    lastLiquiditySeed = seedResults;
    for (const r of seedResults) {
      liquiditySeeded[r.pool] = true;
    }

    console.log("[seed] POST /api/liquidity/seed OK", { blockNumber, txCount: pendingTxs.length });
    const pools = await readPoolsSafe();
    res.json(
      await statePayload({
        results: lastLiquiditySeed,
        pools,
      }),
    );
  } catch (err) {
    await configureDemoMining(false).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[seed] POST /api/liquidity/seed FAILED:", message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/swap/preview", async (req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }

  const { pool, zeroForOne, amountIn } = req.body as {
    pool?: PoolTarget;
    zeroForOne?: boolean;
    amountIn?: string;
  };

  if (!pool || !["hooked", "plain", "both"].includes(pool)) {
    res.status(400).json({ ok: false, error: "pool required (hooked|plain|both)" });
    return;
  }
  if (typeof zeroForOne !== "boolean") {
    res.status(400).json({ ok: false, error: "zeroForOne required (boolean)" });
    return;
  }
  if (!amountIn || Number(amountIn) <= 0) {
    res.status(400).json({ ok: false, error: "amountIn required" });
    return;
  }

  try {
    const amountInRaw = parseSwapAmountIn(zeroForOne, amountIn);
    const preview = await previewSwapFees(
      deployment,
      pool,
      zeroForOne,
      amountInRaw,
      amountIn,
      BigInt(oraclePriceScaled),
    );
    res.json({ ok: true, preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/swap/execute", async (req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }

  const { actorId, pool, zeroForOne, amountIn } = req.body as {
    actorId?: ActorId;
    pool?: PoolTarget;
    zeroForOne?: boolean;
    amountIn?: string;
  };

  if (!actorId || !ACTOR_IDS.includes(actorId)) {
    res.status(400).json({ ok: false, error: "actorId required" });
    return;
  }
  if (!pool || !["hooked", "plain", "both"].includes(pool)) {
    res.status(400).json({ ok: false, error: "pool required (hooked|plain|both)" });
    return;
  }
  if (typeof zeroForOne !== "boolean") {
    res.status(400).json({ ok: false, error: "zeroForOne required (boolean)" });
    return;
  }
  if (!amountIn || Number(amountIn) <= 0) {
    res.status(400).json({ ok: false, error: "amountIn required" });
    return;
  }

  try {
    const pendingTxs: Hex[] = [];
    let swapResults: SwapResult[] = [];

    const blockNumber = await runBlockOperation(async () => {
      const out = await executeSwapsWithHashes(
        deployment!,
        { actorId, pool, zeroForOne, amountIn },
        BigInt(oraclePriceScaled),
      );
      pendingTxs.push(...out.txHashes);
      swapResults = out.results;
    });

    await waitForAllReceipts(pendingTxs);
    swapResults = await finalizeSwapResults(deployment, swapResults, BigInt(oraclePriceScaled));
    lastSwap = swapResults;
    accumulatedFees = accumulateSwapFees(accumulatedFees, swapResults);

    const pools = await readPoolsSafe();
    res.json(await statePayload({ swapResults, blockNumber, pools }));
  } catch (err) {
    await configureDemoMining(false).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/sync/preview", async (_req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }
  if (!liquiditySeeded.hooked) {
    res.status(400).json({ ok: false, error: "Seed hooked pool liquidity first" });
    return;
  }

  try {
    const preview = await previewKeeperSync(deployment, BigInt(oraclePriceScaled));
    res.json({ ok: true, preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/sync/execute", async (_req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }
  if (!liquiditySeeded.hooked) {
    res.status(400).json({ ok: false, error: "Seed hooked pool liquidity first" });
    return;
  }

  try {
    const pendingTxs: Hex[] = [];
    let syncResult: SyncKeeperResult | null = null;

    const blockNumber = await runBlockOperation(async () => {
      const out = await executeKeeperSync(deployment!, BigInt(oraclePriceScaled));
      pendingTxs.push(...out.txHashes);
      syncResult = out.result;
    });

    await waitForAllReceipts(pendingTxs);
    if (syncResult) syncResult = await finalizeKeeperSyncResult(syncResult);
    lastPoolSync = syncResult;
    markPoolSync(blockNumber);

    const pools = await readPoolsSafe();
    res.json(await statePayload({ syncResult, blockNumber, pools }));
  } catch (err) {
    await configureDemoMining(false).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/oracle/price", async (req, res) => {
  if (!deployment) {
    res.status(503).json({ ok: false, error: "Call POST /api/init first" });
    return;
  }

  const { priceScaled } = req.body as { priceScaled?: string };
  if (!priceScaled) {
    res.status(400).json({ ok: false, error: "priceScaled required" });
    return;
  }

  try {
    let feedSync: FeedSyncResult | null = null;
    const blockNumber = await runBlockOperation(async () => {
      feedSync = await sendExecuteFeedOnly(deployment!, BigInt(priceScaled));
    });

    await waitForAllReceipts([feedSync!.txHash]);
    markFeedSync(blockNumber);
    feedEverSynced = true;
    lastFeedSync = feedSync;
    oraclePriceScaled = priceScaled;

    const pools = await readPoolsSafe();
    res.json(await statePayload({ pools }));
  } catch (err) {
    await configureDemoMining(false).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.listen(PORT, () => {
  console.log(`UHI9 demo API http://localhost:${PORT}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
  resetBlockState(FORK_BLOCK);
  try {
    deployment = loadDeployment();
    console.log(`Loaded existing ${DEPLOYMENTS_FILE}`);
  } catch {
    console.log("No deployment yet — UI should POST /api/init");
  }
});
