import { createPublicClient, encodePacked, http, keccak256, type Hex } from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC } from "./accounts.js";
import { POOL_MANAGER } from "./constants.js";
import type { Deployment } from "./deploy.js";
import { amountsForPoolLiquidity, priceScaledFromSqrtPriceX96, tvlUsdtFromAmounts } from "./poolMath.js";

const POOLS_SLOT = "0x0000000000000000000000000000000000000000000000000000000000000006" as Hex;
const LIQUIDITY_OFFSET = 3n;

const POOL_MANAGER_ABI = [
  {
    type: "function",
    name: "extsload",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

export type PoolSnapshot = {
  pool: "hooked" | "plain";
  initialized: boolean;
  /** USDT per 1 WETH, 8-decimal scaled string (same as oracle). */
  priceScaled: string;
  /** Human-readable USDT per WETH. */
  priceUsdtPerEth: number;
  wethWei: string;
  weth: number;
  usdtRaw: string;
  usdt: number;
  tvlUsdt: number;
  liquidity: string;
};

export function emptyPoolSnapshot(pool: "hooked" | "plain"): PoolSnapshot {
  return {
    pool,
    initialized: false,
    priceScaled: "0",
    priceUsdtPerEth: 0,
    wethWei: "0",
    weth: 0,
    usdtRaw: "0",
    usdt: 0,
    tvlUsdt: 0,
    liquidity: "0",
  };
}

function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [poolId, POOLS_SLOT]));
}

async function readPoolState(poolId: Hex): Promise<{ sqrtPriceX96: bigint; liquidity: bigint }> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const stateSlot = poolStateSlot(poolId);
  const slot0 = await client.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [stateSlot],
  });
  const liquiditySlot = `0x${(BigInt(stateSlot) + LIQUIDITY_OFFSET).toString(16).padStart(64, "0")}` as Hex;
  const liquidityData = await client.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [liquiditySlot],
  });

  return {
    sqrtPriceX96: BigInt(slot0) & ((1n << 160n) - 1n),
    liquidity: BigInt(liquidityData) & ((1n << 128n) - 1n),
  };
}

async function snapshotPool(deployment: Deployment, pool: "hooked" | "plain"): Promise<PoolSnapshot> {
  const poolId = (
    pool === "hooked" ? deployment.addresses.hookedPoolId : deployment.addresses.plainPoolId
  ) as Hex;

  const { sqrtPriceX96, liquidity } = await readPoolState(poolId);
  const initialized = sqrtPriceX96 > 0n;
  const hasLiquidity = liquidity > 0n;
  const priceScaled = hasLiquidity ? priceScaledFromSqrtPriceX96(sqrtPriceX96) : 0n;
  const { wethWei, usdtRaw } = amountsForPoolLiquidity(sqrtPriceX96, liquidity);
  const tvlUsdt = hasLiquidity ? tvlUsdtFromAmounts(wethWei, usdtRaw, priceScaled) : 0;

  return {
    pool,
    initialized,
    priceScaled: priceScaled.toString(),
    priceUsdtPerEth: Number(priceScaled) / 1e8,
    wethWei: wethWei.toString(),
    weth: Number(wethWei) / 1e18,
    usdtRaw: usdtRaw.toString(),
    usdt: Number(usdtRaw) / 1e6,
    tvlUsdt,
    liquidity: liquidity.toString(),
  };
}

export async function readPoolSnapshots(deployment: Deployment): Promise<{
  hooked: PoolSnapshot;
  plain: PoolSnapshot;
}> {
  const [hooked, plain] = await Promise.all([
    snapshotPool(deployment, "hooked"),
    snapshotPool(deployment, "plain"),
  ]);
  return { hooked, plain };
}
