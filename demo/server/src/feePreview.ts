import { createPublicClient, http, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC } from "./accounts.js";
import { ETH_USD_FEED_ID } from "./feed.js";
import { PLAIN_POOL_FEE, POOL_MANAGER, USDT, WETH, HOOKED_DEMO_BASE_FEE } from "./constants.js";
import type { Deployment } from "./deploy.js";
import { priceScaledFromSqrtPriceX96 } from "./poolMath.js";
import { poolStateSlot } from "./poolKeys.js";
import type { PoolTarget } from "./liquidity.js";
import { quoteSwapExactIn, estimateSwapAmountOut } from "./quoteSwap.js";

const BPS = 10_000n;
const PIPS = 1_000_000n;
const PPM = 1_000_000n;
const PRICE_DECIMALS = 8;

const POOL_MANAGER_ABI = [
  {
    type: "function",
    name: "extsload",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getPoolConfig",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "baseFeeBps", type: "uint16" },
          { name: "minFeeBps", type: "uint16" },
          { name: "maxFeeBps", type: "uint16" },
          { name: "stalenessSlopePpmPerSec", type: "uint32" },
          { name: "deviationSlopePpmPerBps", type: "uint32" },
          { name: "maxStalenessSec", type: "uint32" },
          { name: "minDonateBps", type: "uint16" },
          { name: "maxDonateBps", type: "uint16" },
          { name: "minImprovementBps", type: "uint16" },
          { name: "minOverwriteImprovementBps", type: "uint16" },
          { name: "maxSlippageBps", type: "uint16" },
          { name: "lpShareBps", type: "uint16" },
          { name: "syncShareBps", type: "uint16" },
          { name: "feedShareBps", type: "uint16" },
          { name: "priceFeedId", type: "bytes32" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

const HOOK_ABI = [
  {
    type: "function",
    name: "getEligibleFeedProvider",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

const SYNC_KEEPERS_ABI = [
  {
    type: "function",
    name: "getActiveSyncKeeper",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "keeper", type: "address" },
      { name: "qualityBps", type: "uint32" },
      { name: "windowEndBlock", type: "uint32" },
      { name: "isActive", type: "bool" },
    ],
    stateMutability: "view",
  },
] as const;

const MOCK_PYTH_ABI = [
  {
    type: "function",
    name: "getPriceNoOlderThan",
    inputs: [{ name: "id", type: "bytes32" }, { name: "age", type: "uint256" }],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export type FeeSplitPreview = {
  pool: "hooked" | "plain";
  feeBps: number;
  feeToken: "WETH" | "USDT";
  totalFeeRaw: string;
  lpShareRaw: string;
  syncShareRaw: string;
  feedShareRaw: string;
  totalFeeUsdt: number;
  lpShareUsdt: number;
  syncShareUsdt: number;
  feedShareUsdt: number;
  syncKeeperActive: boolean;
  feedKeeperActive: boolean;
  syncKeeper: string | null;
  feedKeeper: string | null;
};

export type SwapAmountOutPreview = {
  pool: "hooked" | "plain";
  amountOutRaw: string;
  amountOut: number;
  outputToken: "WETH" | "USDT";
};

export type SwapFeePreview = {
  zeroForOne: boolean;
  amountIn: string;
  amountInRaw: string;
  inputToken: "WETH" | "USDT";
  outputToken: "WETH" | "USDT";
  plain: FeeSplitPreview | null;
  hooked: FeeSplitPreview | null;
  plainAmountOut: SwapAmountOutPreview | null;
  hookedAmountOut: SwapAmountOutPreview | null;
  plainTotalFeeUsdt: number;
  hookedTotalFeeUsdt: number;
};

type PoolConfig = {
  baseFeeBps: number;
  minFeeBps: number;
  maxFeeBps: number;
  stalenessSlopePpmPerSec: number;
  deviationSlopePpmPerBps: number;
  maxStalenessSec: number;
  lpShareBps: number;
  syncShareBps: number;
  feedShareBps: number;
};

function mulDivRoundingUp(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b + d - 1n) / d;
}

function wethToUsdt(wethWei: bigint, priceScaled: bigint): bigint {
  // USDT raw (6 dec) = wethWei * priceScaled / 10^(18 + 8 - 6)
  return (wethWei * priceScaled) / (10n ** 20n);
}

function tokenAmountToUsdt(amount: bigint, token: "WETH" | "USDT", priceScaled: bigint): number {
  if (token === "USDT") return Number(amount) / 1e6;
  return Number(wethToUsdt(amount, priceScaled)) / 1e6;
}

function pythToPriceScaled(price: bigint, expo: number): bigint {
  const target = BigInt(PRICE_DECIMALS);
  if (expo >= 0) return price * 10n ** BigInt(Number(target) + expo);
  const diff = target + BigInt(expo);
  if (diff >= 0n) return price * 10n ** diff;
  return price / 10n ** (-diff);
}

function computeFeeBps(
  oraclePublishTime: bigint,
  nowTs: bigint,
  poolPrice: bigint,
  oraclePrice: bigint,
  cfg: PoolConfig,
): number {
  const stale = nowTs > oraclePublishTime ? nowTs - oraclePublishTime : 0n;
  let dev = 0n;
  if (oraclePrice > 0n) {
    dev =
      poolPrice >= oraclePrice
        ? ((poolPrice - oraclePrice) * BPS) / oraclePrice
        : ((oraclePrice - poolPrice) * BPS) / oraclePrice;
  }

  const addStale = (stale * BigInt(cfg.stalenessSlopePpmPerSec)) / PPM;
  const addDev = (dev * BigInt(cfg.deviationSlopePpmPerBps)) / PPM;
  let raw = BigInt(cfg.baseFeeBps) + addStale + addDev;
  if (raw < BigInt(cfg.minFeeBps)) raw = BigInt(cfg.minFeeBps);
  if (raw > BigInt(cfg.maxFeeBps)) raw = BigInt(cfg.maxFeeBps);
  return Number(raw);
}

function splitSwapFee(
  totalFee: bigint,
  feedKeeper: Address,
  syncKeeper: Address,
  lpShareBps: number,
  syncShareBps: number,
  feedShareBps: number,
): { lp: bigint; sync: bigint; feed: bigint } {
  let syncAmount = (totalFee * BigInt(syncShareBps)) / BPS;
  let feedAmount = (totalFee * BigInt(feedShareBps)) / BPS;
  let lpAmount = totalFee - syncAmount - feedAmount;

  if (feedKeeper === "0x0000000000000000000000000000000000000000" && feedAmount > 0n) {
    lpAmount += feedAmount;
    feedAmount = 0n;
  }
  if (syncKeeper === "0x0000000000000000000000000000000000000000" && syncAmount > 0n) {
    lpAmount += syncAmount;
    syncAmount = 0n;
  }

  return { lp: lpAmount, sync: syncAmount, feed: feedAmount };
}

async function readSqrtPriceX96(poolId: Hex): Promise<bigint> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const data = await client.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [poolStateSlot(poolId)],
  });
  return BigInt(data) & ((1n << 160n) - 1n);
}

async function previewPlain(
  amountIn: bigint,
  zeroForOne: boolean,
  priceScaled: bigint,
): Promise<FeeSplitPreview> {
  const feeToken: "WETH" | "USDT" = zeroForOne ? "WETH" : "USDT";
  const totalFee = mulDivRoundingUp(amountIn, BigInt(PLAIN_POOL_FEE), PIPS);
  const totalUsdt = tokenAmountToUsdt(totalFee, feeToken, priceScaled);

  return {
    pool: "plain",
    feeBps: PLAIN_POOL_FEE,
    feeToken,
    totalFeeRaw: totalFee.toString(),
    lpShareRaw: totalFee.toString(),
    syncShareRaw: "0",
    feedShareRaw: "0",
    totalFeeUsdt: totalUsdt,
    lpShareUsdt: totalUsdt,
    syncShareUsdt: 0,
    feedShareUsdt: 0,
    syncKeeperActive: false,
    feedKeeperActive: false,
    syncKeeper: null,
    feedKeeper: null,
  };
}

async function previewHooked(
  deployment: Deployment,
  amountIn: bigint,
  zeroForOne: boolean,
  priceScaled: bigint,
): Promise<FeeSplitPreview> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const poolId = deployment.addresses.hookedPoolId as Hex;
  const hook = deployment.addresses.dynamicFeeHook as Address;
  const registry = deployment.addresses.registry as Address;
  const syncKeepers = deployment.addresses.syncKeepers as Address;
  const mockPyth = deployment.addresses.mockPyth as Address;

  const cfg = await client.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "getPoolConfig",
    args: [poolId],
  });

  const sqrtPriceX96 = await readSqrtPriceX96(poolId);
  const poolPrice = priceScaledFromSqrtPriceX96(sqrtPriceX96);

  const pyth = await client.readContract({
    address: mockPyth,
    abi: MOCK_PYTH_ABI,
    functionName: "getPriceNoOlderThan",
    args: [ETH_USD_FEED_ID, BigInt(cfg.maxStalenessSec)],
  });
  const oraclePrice = pythToPriceScaled(BigInt(pyth.price), pyth.expo);

  const block = await client.getBlock();
  const feeBps = computeFeeBps(
    BigInt(pyth.publishTime),
    block.timestamp,
    poolPrice,
    oraclePrice,
    cfg,
  );

  const feeToken: "WETH" | "USDT" = zeroForOne ? "WETH" : "USDT";
  const totalFee = mulDivRoundingUp(amountIn, BigInt(feeBps), PIPS);

  const feedKeeper = await client.readContract({
    address: hook,
    abi: HOOK_ABI,
    functionName: "getEligibleFeedProvider",
    args: [poolId],
  });

  const sync = await client.readContract({
    address: syncKeepers,
    abi: SYNC_KEEPERS_ABI,
    functionName: "getActiveSyncKeeper",
    args: [poolId],
  });

  const syncKeeper = sync.isActive ? sync.keeper : ("0x0000000000000000000000000000000000000000" as Address);
  const split = splitSwapFee(
    totalFee,
    feedKeeper,
    syncKeeper,
    cfg.lpShareBps,
    cfg.syncShareBps,
    cfg.feedShareBps,
  );

  const valPrice = priceScaled > 0n ? priceScaled : oraclePrice;

  return {
    pool: "hooked",
    feeBps,
    feeToken,
    totalFeeRaw: totalFee.toString(),
    lpShareRaw: split.lp.toString(),
    syncShareRaw: split.sync.toString(),
    feedShareRaw: split.feed.toString(),
    totalFeeUsdt: tokenAmountToUsdt(totalFee, feeToken, valPrice),
    lpShareUsdt: tokenAmountToUsdt(split.lp, feeToken, valPrice),
    syncShareUsdt: tokenAmountToUsdt(split.sync, feeToken, valPrice),
    feedShareUsdt: tokenAmountToUsdt(split.feed, feeToken, valPrice),
    syncKeeperActive: sync.isActive,
    feedKeeperActive: feedKeeper !== "0x0000000000000000000000000000000000000000",
    syncKeeper: sync.isActive ? sync.keeper : null,
    feedKeeper: feedKeeper !== "0x0000000000000000000000000000000000000000" ? feedKeeper : null,
  };
}

function rawToHuman(raw: bigint, token: "WETH" | "USDT"): number {
  return token === "WETH" ? Number(raw) / 1e18 : Number(raw) / 1e6;
}

async function previewAmountOut(
  deployment: Deployment,
  pool: "hooked" | "plain",
  zeroForOne: boolean,
  amountInRaw: bigint,
  feePips: number,
  keeperPeelRaw = 0n,
): Promise<SwapAmountOutPreview | null> {
  const outputToken: "WETH" | "USDT" = zeroForOne ? "USDT" : "WETH";
  const swapAmountIn = pool === "hooked" ? amountInRaw - keeperPeelRaw : amountInRaw;
  if (swapAmountIn <= 0n) return null;

  try {
    let amountOutRaw = await estimateSwapAmountOut(
      deployment,
      pool,
      zeroForOne,
      swapAmountIn,
      feePips,
    );
    if (amountOutRaw == null) {
      amountOutRaw = await quoteSwapExactIn(deployment, pool, zeroForOne, amountInRaw);
    }
    if (amountOutRaw == null) return null;
    return {
      pool,
      amountOutRaw: amountOutRaw.toString(),
      amountOut: rawToHuman(amountOutRaw, outputToken),
      outputToken,
    };
  } catch {
    return null;
  }
}

export async function previewSwapFees(
  deployment: Deployment,
  poolTarget: PoolTarget,
  zeroForOne: boolean,
  amountInRaw: bigint,
  amountInHuman: string,
  oraclePriceScaled: bigint,
): Promise<SwapFeePreview> {
  const targets: Array<"hooked" | "plain"> =
    poolTarget === "both" ? ["hooked", "plain"] : [poolTarget];

  let plain: FeeSplitPreview | null = null;
  let hooked: FeeSplitPreview | null = null;
  let plainAmountOut: SwapAmountOutPreview | null = null;
  let hookedAmountOut: SwapAmountOutPreview | null = null;

  for (const t of targets) {
    if (t === "plain") {
      plain = await previewPlain(amountInRaw, zeroForOne, oraclePriceScaled);
      plainAmountOut = await previewAmountOut(
        deployment,
        "plain",
        zeroForOne,
        amountInRaw,
        PLAIN_POOL_FEE,
      );
    } else {
      hooked = await previewHooked(deployment, amountInRaw, zeroForOne, oraclePriceScaled);
      const keeperPeelRaw =
        hooked != null
          ? BigInt(hooked.syncShareRaw) + BigInt(hooked.feedShareRaw)
          : 0n;
      hookedAmountOut = await previewAmountOut(
        deployment,
        "hooked",
        zeroForOne,
        amountInRaw,
        hooked?.feeBps ?? HOOKED_DEMO_BASE_FEE,
        keeperPeelRaw,
      );
    }
  }
  const inputToken: "WETH" | "USDT" = zeroForOne ? "WETH" : "USDT";
  const outputToken: "WETH" | "USDT" = zeroForOne ? "USDT" : "WETH";

  return {
    zeroForOne,
    amountIn: amountInHuman,
    amountInRaw: amountInRaw.toString(),
    inputToken,
    outputToken,
    plain,
    hooked,
    plainAmountOut,
    hookedAmountOut,
    plainTotalFeeUsdt: plain?.totalFeeUsdt ?? 0,
    hookedTotalFeeUsdt: hooked?.totalFeeUsdt ?? 0,
  };
}
