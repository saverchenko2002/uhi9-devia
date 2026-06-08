import { usdtRawForWethWei } from "./constants.js";

export type SyncDirection = "poolBelowOracle" | "poolAboveOracle";

export type ProfitSplitDetail = {
  direction: SyncDirection;
  /** minDonateBps from pool config — applied to each profit token */
  minDonateBps: number;
  wethGainUsdt: number;
  usdtMarginUsdt: number;
};

export type ProfitBreakdownUsdt = {
  grossUsdt: number;
  syncKeeperUsdt: number;
  poolDonationUsdt: number;
  plainArbUsdt: number;
  split?: ProfitSplitDetail;
};

function rawUsdtToNumber(raw: bigint): number {
  return Number(raw) / 1e6;
}

/** Full-cycle arb profit in USDT + who receives what (sync keeper path). */
export function syncKeeperProfitBreakdown(
  direction: SyncDirection,
  targetPriceScaled: bigint,
  keeperPayoutUsdtRaw: bigint,
  donationUsdtRaw: bigint,
  keeperPayoutWethRaw: bigint,
  donationWethRaw: bigint,
  minDonateBps: number,
): ProfitBreakdownUsdt {
  const keeperUsdt = rawUsdtToNumber(keeperPayoutUsdtRaw);
  const donateUsdt = rawUsdtToNumber(donationUsdtRaw);
  const keeperWethUsdt = rawUsdtToNumber(usdtRawForWethWei(keeperPayoutWethRaw, targetPriceScaled));
  const donateWethUsdt = rawUsdtToNumber(usdtRawForWethWei(donationWethRaw, targetPriceScaled));

  const syncKeeperUsdt = keeperUsdt + keeperWethUsdt;
  const poolDonationUsdt = donateUsdt + donateWethUsdt;
  const grossUsdt = syncKeeperUsdt + poolDonationUsdt;

  return {
    grossUsdt,
    syncKeeperUsdt,
    poolDonationUsdt,
    plainArbUsdt: 0,
    split: {
      direction,
      minDonateBps,
      wethGainUsdt: keeperWethUsdt + donateWethUsdt,
      usdtMarginUsdt: keeperUsdt + donateUsdt,
    },
  };
}

/** Plain manual arb — 100% to arbitrageur. */
export function plainArbProfitBreakdown(grossUsdt: number): ProfitBreakdownUsdt {
  return {
    grossUsdt,
    syncKeeperUsdt: 0,
    poolDonationUsdt: 0,
    plainArbUsdt: grossUsdt,
  };
}
