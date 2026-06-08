import { createPublicClient, http, type Address } from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC, getActorAccount, type ActorId } from "./accounts.js";
import { POOL_MANAGER, USDT, WETH } from "./constants.js";
import type { Deployment } from "./deploy.js";
import { estimateExactInAmountOut } from "./poolMath.js";
import { buildPoolKey, poolStateSlot } from "./poolKeys.js";
import {
  createAnvilTestClient,
  fundUsdtDirect,
  fundWethDirect,
  setAllowanceDirect,
} from "./tokens.js";

const SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "swapExactIn",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "hookData", type: "bytes" },
      { name: "payer", type: "address" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

const POOL_MANAGER_ABI = [
  {
    type: "function",
    name: "extsload",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

const LIQUIDITY_OFFSET = 3n;

export async function readPoolSwapState(
  deployment: Deployment,
  pool: "hooked" | "plain",
): Promise<{ sqrtPriceX96: bigint; liquidity: bigint } | null> {
  const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const poolId = (pool === "hooked" ? deployment.addresses.hookedPoolId : deployment.addresses.plainPoolId) as `0x${string}`;
  const stateSlot = poolStateSlot(poolId);
  const liquiditySlot = `0x${(BigInt(stateSlot) + LIQUIDITY_OFFSET).toString(16).padStart(64, "0")}` as `0x${string}`;

  try {
    const [slot0, liq] = await Promise.all([
      publicClient.readContract({
        address: POOL_MANAGER,
        abi: POOL_MANAGER_ABI,
        functionName: "extsload",
        args: [stateSlot],
      }),
      publicClient.readContract({
        address: POOL_MANAGER,
        abi: POOL_MANAGER_ABI,
        functionName: "extsload",
        args: [liquiditySlot],
      }),
    ]);
    return {
      sqrtPriceX96: BigInt(slot0) & ((1n << 160n) - 1n),
      liquidity: BigInt(liq) & ((1n << 128n) - 1n),
    };
  } catch {
    return null;
  }
}

export async function estimateSwapAmountOut(
  deployment: Deployment,
  pool: "hooked" | "plain",
  zeroForOne: boolean,
  amountInRaw: bigint,
  feePips: number,
): Promise<bigint | null> {
  const state = await readPoolSwapState(deployment, pool);
  if (!state) return null;
  return estimateExactInAmountOut(
    state.sqrtPriceX96,
    state.liquidity,
    amountInRaw,
    zeroForOne,
    feePips,
  );
}

let quoteChain: Promise<void> = Promise.resolve();

async function withQuoteLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = quoteChain;
  quoteChain = gate;
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** On-chain quote: snapshot → storage fund/approve → eth_call → revert. */
export async function quoteSwapExactIn(
  deployment: Deployment,
  pool: "hooked" | "plain",
  zeroForOne: boolean,
  amountInRaw: bigint,
  actorId: ActorId = "swapper",
): Promise<bigint | null> {
  if (amountInRaw <= 0n) return null;

  return withQuoteLock(async () => {
    const actor = getActorAccount(actorId);
    const testClient = createAnvilTestClient();
    const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
    const swapRouter = deployment.addresses.swapRouter as Address;
    const key = buildPoolKey(deployment, pool);
    const tokenIn = (zeroForOne ? WETH : USDT) as Address;

    const snapshot = await testClient.snapshot();
    try {
      if (zeroForOne) {
        await fundWethDirect(actor.address, amountInRaw);
      } else {
        await fundUsdtDirect(actor.address, amountInRaw);
      }
      await setAllowanceDirect(tokenIn, actor.address, swapRouter, amountInRaw);

      const { result } = await publicClient.simulateContract({
        account: actor.address,
        address: swapRouter,
        abi: SWAP_ROUTER_ABI,
        functionName: "swapExactIn",
        args: [key, zeroForOne, amountInRaw, "0x", actor.address],
      });
      const out = result as bigint;
      return out > 0n ? out : null;
    } catch (err) {
      console.warn("[quote] swap simulate failed", {
        pool,
        zeroForOne,
        amountIn: amountInRaw.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      await testClient.revert({ id: snapshot });
    }
  });
}
