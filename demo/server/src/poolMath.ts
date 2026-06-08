import { TickMath } from "@uniswap/v3-sdk";
import { fullRangeTickLower, fullRangeTickUpper } from "./constants.js";

const Q96 = 2n ** 96n;
const PRICE_DECIMALS = 8;
const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 6;

function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  return (a * b) / denominator;
}

function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  return (a * b + denominator - 1n) / denominator;
}

/** sqrt after exact-in swap (fee taken from input). */
export function sqrtPriceAfterExactIn(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
  feePips: number,
): bigint | null {
  if (liquidity === 0n || sqrtPriceX96 === 0n || amountIn <= 0n) return null;

  const fee = mulDivRoundingUp(amountIn, BigInt(feePips), 1_000_000n);
  const amountInLessFee = amountIn - fee;
  if (amountInLessFee <= 0n) return null;

  if (zeroForOne) {
    const product = amountInLessFee * sqrtPriceX96;
    const denominator = liquidity * Q96 + product;
    if (denominator === 0n) return null;
    return (liquidity * Q96 * sqrtPriceX96) / denominator;
  }

  const quotient = mulDivRoundingUp(amountInLessFee, Q96, liquidity);
  return sqrtPriceX96 + quotient;
}

/** token1 per token0 at PRICE_DECIMALS (matches PoolPriceLib). */
export function priceScaledFromSqrtPriceX96(sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const unitAmount0 = 10n ** BigInt(PRICE_DECIMALS + TOKEN0_DECIMALS);
  const amount1AtSqrt = mulDiv(sqrtPriceX96 * sqrtPriceX96, unitAmount0, Q96 * Q96);
  return amount1AtSqrt / 10n ** BigInt(TOKEN1_DECIMALS);
}

function getSqrtPriceAtTick(tick: number): bigint {
  return BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
}

/** WETH (token0) + USDT (token1) locked at current pool price for active liquidity. */
export function amountsForPoolLiquidity(
  sqrtPriceX96: bigint,
  liquidity: bigint,
): { wethWei: bigint; usdtRaw: bigint } {
  if (liquidity === 0n || sqrtPriceX96 === 0n) {
    return { wethWei: 0n, usdtRaw: 0n };
  }

  const tickLower = fullRangeTickLower();
  const tickUpper = fullRangeTickUpper();
  const sqrtLower = getSqrtPriceAtTick(tickLower);
  const sqrtUpper = getSqrtPriceAtTick(tickUpper);

  let sqrtA = sqrtLower;
  let sqrtB = sqrtUpper;
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];

  let wethWei = 0n;
  let usdtRaw = 0n;

  if (sqrtPriceX96 <= sqrtA) {
    wethWei = mulDiv(mulDiv(liquidity << 96n, sqrtB - sqrtA, sqrtB), 1n, sqrtA);
  } else if (sqrtPriceX96 < sqrtB) {
    wethWei = mulDiv(mulDiv(liquidity << 96n, sqrtB - sqrtPriceX96, sqrtB), 1n, sqrtPriceX96);
    usdtRaw = mulDiv(liquidity, sqrtPriceX96 - sqrtA, Q96);
  } else {
    usdtRaw = mulDiv(liquidity, sqrtB - sqrtA, Q96);
  }

  return { wethWei, usdtRaw };
}

export function estimateExactInAmountOut(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
  feePips: number,
): bigint | null {
  if (liquidity === 0n || sqrtPriceX96 === 0n || amountIn <= 0n) return null;

  const fee = (amountIn * BigInt(feePips) + 999_999n) / 1_000_000n;
  const amountInLessFee = amountIn - fee;
  if (amountInLessFee <= 0n) return null;

  if (zeroForOne) {
    const product = amountInLessFee * sqrtPriceX96;
    const denominator = liquidity * Q96 + product;
    if (denominator === 0n) return null;
    const sqrtNext = (liquidity * Q96 * sqrtPriceX96) / denominator;
    if (sqrtNext >= sqrtPriceX96) return null;
    return mulDiv(liquidity, sqrtPriceX96 - sqrtNext, Q96);
  }

  // USDT → WETH (token1 in): sqrtPrice += ceil(amountIn * Q96 / liquidity)
  const quotient = mulDivRoundingUp(amountInLessFee, Q96, liquidity);
  if (quotient === 0n) return null;
  const sqrtNext = sqrtPriceX96 + quotient;
  if (sqrtNext <= sqrtPriceX96) return null;
  return mulDiv(mulDiv(liquidity << 96n, sqrtNext - sqrtPriceX96, sqrtNext), 1n, sqrtPriceX96);
}

export function tvlUsdtFromAmounts(
  wethWei: bigint,
  usdtRaw: bigint,
  priceScaled: bigint,
): number {
  const weth = Number(wethWei) / 1e18;
  const usdt = Number(usdtRaw) / 1e6;
  const price = Number(priceScaled) / 1e8;
  return weth * price + usdt;
}
