export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
export const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as const;
export const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90" as const;

/** Uniswap v4 dynamic-fee flag (LPFeeLibrary.DYNAMIC_FEE_FLAG). */
export const DYNAMIC_FEE_FLAG = 0x800000;
/** Plain pool static fee pips (PoolConfigLib.BASE_FEE_BPS). */
export const PLAIN_POOL_FEE = 66;
export const TICK_SPACING = 60;

const MIN_TICK = -887272;
const MAX_TICK = 887272;

export function fullRangeTickLower(): number {
  return Math.trunc(MIN_TICK / TICK_SPACING) * TICK_SPACING;
}

export function fullRangeTickUpper(): number {
  return Math.trunc(MAX_TICK / TICK_SPACING) * TICK_SPACING;
}

/** token1 (USDT) for `wethHuman` WETH at `priceScaled` (8 decimals). */
export function usdtForWeth(wethHuman: number, priceScaled: bigint): bigint {
  const wethWei = BigInt(Math.round(wethHuman * 1e18));
  return (wethWei * priceScaled * 1_000_000n) / (100_000_000n * 1_000_000_000_000_000_000n);
}
