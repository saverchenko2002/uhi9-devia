import type { FeeSplitPreview } from "./feePreview.js";
import type { SwapResult } from "./swap.js";

export type AccumulatedPoolFees = {
  totalFeeUsdt: number;
  lpShareUsdt: number;
  syncShareUsdt: number;
  feedShareUsdt: number;
  swapCount: number;
};

export type AccumulatedFees = {
  plain: AccumulatedPoolFees;
  hooked: AccumulatedPoolFees;
};

function emptyPoolFees(): AccumulatedPoolFees {
  return {
    totalFeeUsdt: 0,
    lpShareUsdt: 0,
    syncShareUsdt: 0,
    feedShareUsdt: 0,
    swapCount: 0,
  };
}

export function emptyAccumulatedFees(): AccumulatedFees {
  return { plain: emptyPoolFees(), hooked: emptyPoolFees() };
}

export function accumulateSwapFees(
  acc: AccumulatedFees,
  swapResults: SwapResult[],
): AccumulatedFees {
  const next = {
    plain: { ...acc.plain },
    hooked: { ...acc.hooked },
  };

  for (const r of swapResults) {
    const bucket = r.pool === "plain" ? next.plain : next.hooked;
    addFeeSplit(bucket, r.fees);
  }

  return next;
}

function addFeeSplit(bucket: AccumulatedPoolFees, fees: FeeSplitPreview): void {
  bucket.totalFeeUsdt += fees.totalFeeUsdt;
  bucket.lpShareUsdt += fees.lpShareUsdt;
  bucket.syncShareUsdt += fees.syncShareUsdt;
  bucket.feedShareUsdt += fees.feedShareUsdt;
  bucket.swapCount += 1;
}
