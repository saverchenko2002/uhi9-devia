import type { Hex } from "viem";
import type { AccumulatedFees } from "./accumulatedFees.js";
import type { SeedLiquidityResult, WithdrawLiquidityResult } from "./liquidity.js";
import type { PlainArbResult } from "./plainArb.js";
import { usdtRawForWethWei } from "./constants.js";
import type { SyncKeeperResult } from "./syncKeeper.js";
import type { TreasuryClaimResult } from "./treasury.js";

export type LpSnapshotUsdt = {
  wethRaw: string;
  usdtRaw: string;
  weth: number;
  usdt: number;
  valueUsdt: number;
};

export type PoolFeesReport = {
  totalFeeUsdt: number;
  lpShareUsdt: number;
  syncShareUsdt: number;
  feedShareUsdt: number;
  swapCount: number;
};

export type SideReport = {
  pool: "plain" | "hooked";
  initialLp: LpSnapshotUsdt;
  extractedLp: LpSnapshotUsdt;
  /** extracted value − deposit value @ oracle */
  ilUsdt: number;
  swapFees: PoolFeesReport;
};

export type ActorProfits = {
  plainArbUsdt: number;
  syncKeeperArbUsdt: number;
  syncKeeperSwapFeesUsdt: number;
  syncKeeperTotalUsdt: number;
  feedKeeperSwapFeesUsdt: number;
  poolDonationUsdt: number;
};

export type DistributionFlow = {
  label: string;
  amountUsdt: number;
  tone: "lp" | "pool" | "sync" | "feed" | "arb";
};

export type LpComparisonSummary = {
  depositUsdt: number;
  plainExtractedUsdt: number;
  hookedExtractedUsdt: number;
  /** extracted − deposit @ oracle (fees + donation − arb drain) */
  plainNetUsdt: number;
  hookedNetUsdt: number;
  /** hookedNet − plainNet; positive ⇒ hooked LPs retained more value */
  hookedAdvantageUsdt: number;
};

export type ComparisonReport = {
  valuationPriceScaled: string;
  plain: SideReport;
  hooked: SideReport;
  actors: ActorProfits;
  lpComparison: LpComparisonSummary;
  plainFlow: DistributionFlow[];
  hookedFlow: DistributionFlow[];
  txHashes: Hex[];
  collectedAtBlock: number;
};

function rawUsdt(raw: bigint): number {
  return Number(raw) / 1e6;
}

function rawWeth(wei: bigint): number {
  return Number(wei) / 1e18;
}

function lpSnapshotFromRaw(
  wethRaw: bigint,
  usdtRaw: bigint,
  priceScaled: bigint,
): LpSnapshotUsdt {
  const wethVal = rawUsdt(usdtRawForWethWei(wethRaw, priceScaled));
  const usdtVal = rawUsdt(usdtRaw);
  return {
    wethRaw: wethRaw.toString(),
    usdtRaw: usdtRaw.toString(),
    weth: rawWeth(wethRaw),
    usdt: usdtVal,
    valueUsdt: wethVal + usdtVal,
  };
}

function feesFromAccumulated(bucket: AccumulatedFees["plain"]): PoolFeesReport {
  return {
    totalFeeUsdt: bucket.totalFeeUsdt,
    lpShareUsdt: bucket.lpShareUsdt,
    syncShareUsdt: bucket.syncShareUsdt,
    feedShareUsdt: bucket.feedShareUsdt,
    swapCount: bucket.swapCount,
  };
}

function treasuryClaimedUsdt(
  usdtClaimed: bigint,
  wethClaimed: bigint,
  priceScaled: bigint,
): number {
  return rawUsdt(usdtClaimed) + rawUsdt(usdtRawForWethWei(wethClaimed, priceScaled));
}

function seedForPool(
  seeds: SeedLiquidityResult[],
  pool: "plain" | "hooked",
): SeedLiquidityResult | undefined {
  return seeds.find((s) => s.pool === pool);
}

export type BuildComparisonReportInput = {
  oraclePriceScaled: bigint;
  lastLiquiditySeed: SeedLiquidityResult[];
  lastPoolSync: SyncKeeperResult | null;
  lastPlainArb: PlainArbResult | null;
  accumulatedFees: AccumulatedFees;
  syncTreasury: TreasuryClaimResult;
  feedTreasury: TreasuryClaimResult;
  plainWithdraw: WithdrawLiquidityResult;
  hookedWithdraw: WithdrawLiquidityResult;
  txHashes: Hex[];
  collectedAtBlock: number;
};

export function buildComparisonReport(input: BuildComparisonReportInput): ComparisonReport {
  const {
    oraclePriceScaled,
    lastLiquiditySeed,
    lastPoolSync,
    lastPlainArb,
    accumulatedFees,
    syncTreasury,
    feedTreasury,
    plainWithdraw,
    hookedWithdraw,
    txHashes,
    collectedAtBlock,
  } = input;

  const plainSeed = seedForPool(lastLiquiditySeed, "plain");
  const hookedSeed = seedForPool(lastLiquiditySeed, "hooked");

  if (!plainSeed || !hookedSeed) {
    throw new Error("Seed both pools before collecting the report");
  }

  if (plainWithdraw.wethWithdrawn === 0n && plainWithdraw.usdtWithdrawn === 0n) {
    throw new Error("Plain pool LP withdraw returned zero — check pool liquidity");
  }
  if (hookedWithdraw.wethWithdrawn === 0n && hookedWithdraw.usdtWithdrawn === 0n) {
    throw new Error("Hooked pool LP withdraw returned zero — check pool liquidity");
  }

  const initialWeth = BigInt(plainSeed.weth);
  const initialUsdt = BigInt(plainSeed.usdt);
  const initialLp = lpSnapshotFromRaw(initialWeth, initialUsdt, oraclePriceScaled);

  const plainExtracted = lpSnapshotFromRaw(
    plainWithdraw.wethWithdrawn,
    plainWithdraw.usdtWithdrawn,
    oraclePriceScaled,
  );
  const hookedExtracted = lpSnapshotFromRaw(
    hookedWithdraw.wethWithdrawn,
    hookedWithdraw.usdtWithdrawn,
    oraclePriceScaled,
  );

  const plainArbUsdt = lastPlainArb?.profitBreakdownUsdt?.plainArbUsdt ?? 0;
  const syncKeeperArbUsdt = lastPoolSync?.profitBreakdownUsdt?.syncKeeperUsdt ?? 0;
  const poolDonationUsdt = lastPoolSync?.profitBreakdownUsdt?.poolDonationUsdt ?? 0;
  const syncKeeperSwapFeesUsdt = treasuryClaimedUsdt(
    syncTreasury.usdtClaimed,
    syncTreasury.wethClaimed,
    oraclePriceScaled,
  );
  const feedKeeperSwapFeesUsdt = treasuryClaimedUsdt(
    feedTreasury.usdtClaimed,
    feedTreasury.wethClaimed,
    oraclePriceScaled,
  );

  const plainFlow: DistributionFlow[] = [
    { label: "LP · liquidity extracted", amountUsdt: plainExtracted.valueUsdt, tone: "lp" },
    { label: "Plain arbitrageur · arb profit", amountUsdt: plainArbUsdt, tone: "arb" },
  ].filter((f) => f.amountUsdt > 0.001);

  const hookedFlow: DistributionFlow[] = [
    { label: "LP · liquidity extracted", amountUsdt: hookedExtracted.valueUsdt, tone: "lp" },
    { label: "Pool · sync donation", amountUsdt: poolDonationUsdt, tone: "pool" },
    { label: "Sync keeper · arb payout", amountUsdt: syncKeeperArbUsdt, tone: "sync" },
    { label: "Sync keeper · swap fees", amountUsdt: syncKeeperSwapFeesUsdt, tone: "sync" },
    { label: "Feed keeper · swap fees", amountUsdt: feedKeeperSwapFeesUsdt, tone: "feed" },
  ].filter((f) => f.amountUsdt > 0.001);

  const plainNetUsdt = plainExtracted.valueUsdt - initialLp.valueUsdt;
  const hookedNetUsdt = hookedExtracted.valueUsdt - initialLp.valueUsdt;

  return {
    valuationPriceScaled: oraclePriceScaled.toString(),
    plain: {
      pool: "plain",
      initialLp,
      extractedLp: plainExtracted,
      ilUsdt: plainNetUsdt,
      swapFees: feesFromAccumulated(accumulatedFees.plain),
    },
    hooked: {
      pool: "hooked",
      initialLp,
      extractedLp: hookedExtracted,
      ilUsdt: hookedNetUsdt,
      swapFees: feesFromAccumulated(accumulatedFees.hooked),
    },
    lpComparison: {
      depositUsdt: initialLp.valueUsdt,
      plainExtractedUsdt: plainExtracted.valueUsdt,
      hookedExtractedUsdt: hookedExtracted.valueUsdt,
      plainNetUsdt,
      hookedNetUsdt,
      hookedAdvantageUsdt: hookedNetUsdt - plainNetUsdt,
    },
    actors: {
      plainArbUsdt,
      syncKeeperArbUsdt,
      syncKeeperSwapFeesUsdt,
      syncKeeperTotalUsdt: syncKeeperArbUsdt + syncKeeperSwapFeesUsdt,
      feedKeeperSwapFeesUsdt,
      poolDonationUsdt,
    },
    plainFlow,
    hookedFlow,
    txHashes,
    collectedAtBlock,
  };
}
