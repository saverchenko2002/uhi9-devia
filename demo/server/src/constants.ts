export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
export const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as const;
export const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90" as const;

/** Uniswap v4 dynamic-fee flag (LPFeeLibrary.DYNAMIC_FEE_FLAG). */
export const DYNAMIC_FEE_FLAG = 0x800000;
/** Plain pool static fee pips (demo ~1.01%, unique vs mainnet 10000-tier pools). */
export const PLAIN_POOL_FEE = 10_066;
/** Hooked pool demo fee band (v4 pips). */
export const HOOKED_DEMO_BASE_FEE = 10_066;
export const HOOKED_DEMO_MIN_FEE = 5_033;
export const HOOKED_DEMO_MAX_FEE = 30_198;
export const TICK_SPACING = 60;
export const PRICE_DECIMALS = 8;

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
  return usdtRawForWethWei(wethWei, priceScaled);
}

/** USDT raw (6 dec) for `wethWei` at `priceScaled` (8 dec per ETH). */
export function usdtRawForWethWei(wethWei: bigint, priceScaled: bigint): bigint {
  return (wethWei * priceScaled) / 10n ** 20n;
}

/** WETH wei for `usdtRaw` at `priceScaled` (inverse of usdtRawForWethWei). */
export function wethRawForUsdtRaw(usdtRaw: bigint, priceScaled: bigint): bigint {
  if (priceScaled === 0n) return 0n;
  return (usdtRaw * 10n ** 20n) / priceScaled;
}
