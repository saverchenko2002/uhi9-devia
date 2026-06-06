// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/src/console2.sol";

import {PoolComparisonTypes} from "test/helpers/comparison/PoolComparisonTypes.t.sol";
import {FeeAccruedParser} from "test/helpers/fee/FeeAccruedParser.t.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolComparisonTestBase} from "test/integration/comparison/base/PoolComparisonTestBase.t.sol";

/// @title Hooked vs plain pool — IL / fee / arb distribution comparison
/// @notice Runs the same scripted flow on two WETH/USDT pools:
///         1) hooked DynamicFee pool with keeper sync
///         2) plain static-fee v4 pool with manual arb
contract HookedVsPlainPool_IlComparison_Test is PoolComparisonTestBase {

    function test_compareDistribution_hookedVsPlainPool() public {
        uint256 startPrice = TestConstants.ETH_USDT_PRICE_SCALED;
        uint256 finalPrice = TestConstants.ETH_USDT_PRICE_SCALED_TARGET;

        assertApproxEqAbs(_poolPriceScaled(poolKey), startPrice, 1e8, "hooked pool start price");
        assertApproxEqAbs(_poolPriceScaled(plainPoolKey), startPrice, 1e8, "plain pool start price");

        // Step 3 — small two-way swaps while oracle still matches the pool (~3000).
        FeeAccruedParser.Totals memory hookedFeesRound1 =
            _runSmallSwapRoundWithFeeTracking(poolKey, poolId, trader);
        _runSmallSwapRound(plainPoolKey, trader);

        // Step 4 — oracle moves to 3100; pools stay near 3000 until arb/sync.
        _seedOracleAtTarget();

        // Step 5 — hooked pool: keeper sync via executeWithIntent.
        (uint256 hookedDonation, uint256 hookedKeeperPayout,) = _executeHookedSyncArbWithReport();

        // Step 6 — plain pool: pool swap + external mock DEX at 3100.
        uint256 plainArbProfit = _executePlainPoolArb();
        console2.log("--- Plain pool manual arb ---");
        console2.log("arbProfit (USDT, net of pool capital)", plainArbProfit);

        // Step 7 — another round of small swaps (pool now near 3100, oracle at 3100).
        FeeAccruedParser.Totals memory hookedFeesRound2 =
            _runSmallSwapRoundWithFeeTracking(poolKey, poolId, trader);
        _runSmallSwapRound(plainPoolKey, trader);

        FeeAccruedParser.Totals memory hookedSwapFees =
            FeeAccruedParser.merge(hookedFeesRound1, hookedFeesRound2);
        FeeAccruedParser.ValuedTotals memory hookedFeesValued =
            FeeAccruedParser.valueInUsdt(hookedSwapFees, finalPrice);
        uint256 plainSwapFeesEstimate = _estimatePlainSwapFeesUsdt(finalPrice);

        // Step 8 — burn LP and assemble final distribution reports.
        PoolComparisonTypes.LpSnapshot memory plainFinalLp = _burnLpPosition(plainPoolKey, plainLpLiquidity);
        plainFinalLp.valueUsdt = _valueAtPrice(plainFinalLp.weth, plainFinalLp.usdt, finalPrice);

        PoolComparisonTypes.LpSnapshot memory hookedFinalLp =
            _burnLpPosition(poolKey, hookedLpLiquidity);
        hookedFinalLp.valueUsdt =
            _valueAtPrice(hookedFinalLp.weth, hookedFinalLp.usdt, finalPrice);

        PoolComparisonTypes.SideReport memory plainReport = PoolComparisonTypes.SideReport({
            initialLp: PoolComparisonTypes.LpSnapshot({
                weth: LP_WETH, usdt: _lpUsdtAmount(), valueUsdt: 0
            }),
            finalLp: plainFinalLp,
            swapFeesToLpUsdt: plainSwapFeesEstimate,
            arbProfitUsdt: plainArbProfit,
            poolDonationUsdt: 0,
            keeperPayoutUsdt: 0,
            treasuryClaimableUsdt: 0,
            treasuryClaimableWethUsdt: 0,
            treasuryTotalUsdt: 0
        });

        (
            uint256 treasuryUsdt,
            uint256 treasuryWethUsdt,
            uint256 treasuryTotalUsdt
        ) = _syncKeeperTreasuryInUsdt(finalPrice);

        PoolComparisonTypes.SideReport memory hookedReport = PoolComparisonTypes.SideReport({
            initialLp: PoolComparisonTypes.LpSnapshot({
                weth: LP_WETH, usdt: _lpUsdtAmount(), valueUsdt: 0
            }),
            finalLp: hookedFinalLp,
            swapFeesToLpUsdt: hookedFeesValued.lpShareUsdt,
            arbProfitUsdt: hookedKeeperPayout,
            poolDonationUsdt: hookedDonation,
            keeperPayoutUsdt: hookedKeeperPayout,
            treasuryClaimableUsdt: treasuryUsdt,
            treasuryClaimableWethUsdt: treasuryWethUsdt,
            treasuryTotalUsdt: treasuryTotalUsdt
        });

        _logPlainReport(plainReport);
        _logHookedReport(hookedReport, hookedFeesValued);

        assertGt(plainArbProfit, 0, "plain arb profit");
        assertGt(hookedKeeperPayout, 0, "hooked keeper payout");
        assertGt(hookedDonation, 0, "hooked pool donation");
        assertApproxEqAbs(_poolPriceScaled(poolKey), finalPrice, 5e8, "hooked pool synced");
        assertApproxEqAbs(_poolPriceScaled(plainPoolKey), finalPrice, 5e8, "plain pool synced");
    }

    function _executeHookedSyncArbWithReport()
        internal
        returns (uint256 donationAmount, uint256 keeperPayout, uint256 actualProfit)
    {
        (actualProfit, donationAmount, keeperPayout) = _executeHookedSyncArb();

        console2.log("--- Hooked sync (executeWithIntent) ---");
        console2.log("actualProfit", actualProfit);
        console2.log("donationAmount (back to pool)", donationAmount);
        console2.log("keeperPayout (wrapped to sync keeper)", keeperPayout);
    }

    function _logPlainReport(PoolComparisonTypes.SideReport memory report) internal pure {
        console2.log("");
        console2.log("======== PLAIN POOL (static 0.30% fee, no hook) ========");
        console2.log("LP deposit (WETH)", report.initialLp.weth);
        console2.log("LP deposit (USDT)", report.initialLp.usdt);
        console2.log("LP final withdrawal value at 3100 (USDT)", report.finalLp.valueUsdt);
        console2.log("estimated swap fees to LPs (USDT)", report.swapFeesToLpUsdt);
        console2.log("arb profit to arbitrageur (USDT, net of pool capital)", report.arbProfitUsdt);
    }

    function _logHookedReport(
        PoolComparisonTypes.SideReport memory report,
        FeeAccruedParser.ValuedTotals memory swapFees
    ) internal view {
        console2.log("");
        console2.log("======== HOOKED POOL (DynamicFee + keeper sync) ========");
        console2.log("LP deposit (WETH)", report.initialLp.weth);
        console2.log("LP deposit (USDT)", report.initialLp.usdt);
        console2.log("LP final withdrawal value at 3100 (USDT)", report.finalLp.valueUsdt);
        console2.log("LP share from public swap fees (USDT valued)", report.swapFeesToLpUsdt);
        console2.log("pool donation from sync arb (USDT)", report.poolDonationUsdt);
        console2.log("arb profit to sync keeper wallet (USDT)", report.keeperPayoutUsdt);
        console2.log("sync keeper treasury.claimable USDT", report.treasuryClaimableUsdt);
        console2.log("sync keeper treasury.claimable WETH in USDT (at 3100)", report.treasuryClaimableWethUsdt);
        console2.log("sync keeper treasury total in USDT", report.treasuryTotalUsdt);
        console2.log("--- public swap fee split (USDT valued at 3100) ---");
        console2.log("total swap fees (USDT)", swapFees.totalFeeUsdt);
        console2.log("LP share (USDT)", swapFees.lpShareUsdt);
        console2.log("sync keeper share (USDT)", swapFees.syncShareUsdt);
        console2.log("feed keeper share (USDT)", swapFees.feedShareUsdt);
    }

}
