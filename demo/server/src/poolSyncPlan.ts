import JSBI from "jsbi";
import { SqrtPriceMath } from "@uniswap/v3-sdk";
import type { Deployment } from "./deploy.js";
import { PRICE_DECIMALS, PLAIN_POOL_FEE } from "./constants.js";
import { priceScaledFromSqrtPriceX96, sqrtPriceAfterExactIn } from "./poolMath.js";
import { readPoolSwapState } from "./quoteSwap.js";

const BPS = 10_000n;
const PIPS = 1_000_000n;
const MIN_SQRT = 4295128739n;
const MAX_SQRT = 1461446703485210103287273052203988822378723970342n;

export type QuoteToTargetPlan = {
  zeroForOne: boolean;
  amountIn: bigint;
  amountOut: bigint;
  poolPriceScaled: bigint;
  targetPriceScaled: bigint;
  poolDeviationBps: number;
};

function toJsbi(n: bigint): JSBI {
  return JSBI.BigInt(n.toString());
}

function fromJsbi(n: JSBI): bigint {
  return BigInt(n.toString());
}

/** token1 (USDT) per token0 (WETH) at PRICE_DECIMALS — matches PoolPriceLib. */
export function sqrtPriceX96FromPriceScaled(priceScaled: bigint): bigint {
  if (priceScaled === 0n) return 0n;
  const amount1 = priceScaled * 10n ** 6n;
  const amount0 = 10n ** (BigInt(PRICE_DECIMALS) + 18n);
  const ratio = (amount1 << 192n) / amount0;
  let z = ratio;
  let y = (z + 1n) / 2n;
  while (y < z) {
    z = y;
    y = (z + ratio / z) / 2n;
  }
  return z;
}

function clampSqrt(sqrt: bigint): bigint {
  if (sqrt <= MIN_SQRT || sqrt >= MAX_SQRT) {
    throw new Error("Target price out of pool bounds");
  }
  return sqrt;
}

export function poolDeviationBps(poolPrice: bigint, targetPrice: bigint): number {
  if (targetPrice === 0n) return 0;
  const diff = poolPrice >= targetPrice ? poolPrice - targetPrice : targetPrice - poolPrice;
  return Number((diff * BPS) / targetPrice);
}

function mulDivRoundingUp(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b + d - 1n) / d;
}

/** PoolSyncLib amountIn is fee-free; bump so post-fee input reaches target sqrt. */
export function amountInIncludingSwapFee(idealAmountIn: bigint, feePips: number): bigint {
  if (idealAmountIn === 0n) return 0n;
  const fee = BigInt(feePips);
  if (fee >= PIPS) return idealAmountIn;
  return mulDivRoundingUp(idealAmountIn, PIPS, PIPS - fee);
}

function priceReachedTarget(
  sqrtAfter: bigint,
  targetSqrt: bigint,
  zeroForOne: boolean,
): boolean {
  if (zeroForOne) return sqrtAfter <= targetSqrt + 1n;
  return sqrtAfter >= targetSqrt - 1n;
}

/** Fee-aware sizing: binary-search minimum swapIn that reaches oracle price after static fee. */
export async function planPlainSwapToTarget(
  deployment: Deployment,
  targetPriceScaled: bigint,
  feePips: number = PLAIN_POOL_FEE,
): Promise<QuoteToTargetPlan & { swapAmountIn: bigint }> {
  const base = await planQuoteSwapToTarget(deployment, "plain", targetPriceScaled);
  if (base.amountIn === 0n) {
    return { ...base, swapAmountIn: 0n };
  }

  const state = await readPoolSwapState(deployment, "plain");
  if (!state) throw new Error("Pool has no liquidity");

  const targetSqrt = sqrtPriceX96FromPriceScaled(targetPriceScaled);
  let lo = base.amountIn;
  let hi = amountInIncludingSwapFee(base.amountIn, feePips);

  for (let i = 0; i < 48 && lo < hi; i++) {
    const mid = (lo + hi) / 2n;
    const sqrtAfter = sqrtPriceAfterExactIn(
      state.sqrtPriceX96,
      state.liquidity,
      mid,
      base.zeroForOne,
      feePips,
    );
    if (sqrtAfter != null && priceReachedTarget(sqrtAfter, targetSqrt, base.zeroForOne)) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }

  let swapAmountIn = hi;
  for (let n = 0; n < 10_000; n++) {
    const sqrtAfter = sqrtPriceAfterExactIn(
      state.sqrtPriceX96,
      state.liquidity,
      swapAmountIn,
      base.zeroForOne,
      feePips,
    );
    if (sqrtAfter != null && priceReachedTarget(sqrtAfter, targetSqrt, base.zeroForOne)) break;
    swapAmountIn += 1n;
  }

  return {
    ...base,
    swapAmountIn,
    poolDeviationBps: poolDeviationBps(base.poolPriceScaled, targetPriceScaled),
  };
}

/** Same sizing as PoolSyncLib.planQuoteSwapToTarget (no registry). */
export async function planQuoteSwapToTarget(
  deployment: Deployment,
  pool: "hooked" | "plain",
  targetPriceScaled: bigint,
): Promise<QuoteToTargetPlan> {
  if (targetPriceScaled === 0n) throw new Error("Target price is zero");

  const state = await readPoolSwapState(deployment, pool);
  if (!state || state.liquidity === 0n) throw new Error("Pool has no liquidity");

  const poolSqrt = state.sqrtPriceX96;
  const targetSqrt = clampSqrt(sqrtPriceX96FromPriceScaled(targetPriceScaled));
  const liq = toJsbi(state.liquidity);
  const poolPriceScaled = priceScaledFromSqrtPriceX96(poolSqrt);

  if (poolSqrt === targetSqrt) {
    return {
      zeroForOne: false,
      amountIn: 0n,
      amountOut: 0n,
      poolPriceScaled,
      targetPriceScaled,
      poolDeviationBps: 0,
    };
  }

  let zeroForOne: boolean;
  let amountIn: bigint;
  let amountOut: bigint;

  if (poolSqrt > targetSqrt) {
    zeroForOne = true;
    amountIn = fromJsbi(
      SqrtPriceMath.getAmount0Delta(
        toJsbi(targetSqrt),
        toJsbi(poolSqrt),
        liq,
        true,
      ),
    );
    amountOut = fromJsbi(
      SqrtPriceMath.getAmount1Delta(
        toJsbi(targetSqrt),
        toJsbi(poolSqrt),
        liq,
        false,
      ),
    );
  } else {
    zeroForOne = false;
    amountIn = fromJsbi(
      SqrtPriceMath.getAmount1Delta(
        toJsbi(poolSqrt),
        toJsbi(targetSqrt),
        liq,
        true,
      ),
    );
    amountOut = fromJsbi(
      SqrtPriceMath.getAmount0Delta(
        toJsbi(poolSqrt),
        toJsbi(targetSqrt),
        liq,
        false,
      ),
    );
  }

  return {
    zeroForOne,
    amountIn,
    amountOut,
    poolPriceScaled,
    targetPriceScaled,
    poolDeviationBps: poolDeviationBps(poolPriceScaled, targetPriceScaled),
  };
}
