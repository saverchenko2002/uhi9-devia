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

    struct ComparisonArbPhase {
        uint256 hookedDonation;
        uint256 hookedKeeperPayout;
        uint256 plainArbProfit;
    }

    struct ComparisonReports {
        PoolComparisonTypes.SideReport plain;
        PoolComparisonTypes.SideReport hooked;
        FeeAccruedParser.ValuedTotals hookedSwapFees;
    }

    function test_compareDistribution_hookedVsPlainPool() public {
        _assertPoolsStartAtPrice(TestConstants.ETH_USDT_PRICE_SCALED);

        FeeAccruedParser.Totals memory hookedFeesRound1 = _round1Swaps();
        _seedOracleAtTarget();

        ComparisonArbPhase memory arb = _runArbPhase();
        FeeAccruedParser.Totals memory hookedFeesRound2 = _round2Swaps();

        ComparisonReports memory reports = _buildReports(arb, hookedFeesRound1, hookedFeesRound2);
        _logReports(reports);
        _assertComparisonOutcome(arb);
    }

    function _assertPoolsStartAtPrice(uint256 priceScaled) internal view {
        assertApproxEqAbs(_poolPriceScaled(poolKey), priceScaled, 1e8, "hooked pool start price");
        assertApproxEqAbs(_poolPriceScaled(plainPoolKey), priceScaled, 1e8, "plain pool start price");
    }

    function _round1Swaps() internal returns (FeeAccruedParser.Totals memory fees) {
        fees = _runSmallSwapRoundWithFeeTracking(poolKey, poolId, trader);
        _runSmallSwapRound(plainPoolKey, trader);
    }

    function _runArbPhase() internal returns (ComparisonArbPhase memory arb) {
        (arb.hookedDonation, arb.hookedKeeperPayout,) = _executeHookedSyncArbWithReport();
        arb.plainArbProfit = _executePlainPoolArb();

        console2.log("--- Plain pool manual arb ---");
        console2.log("arbProfit (USDT, net of pool capital)", arb.plainArbProfit);
    }

    function _round2Swaps() internal returns (FeeAccruedParser.Totals memory fees) {
        fees = _runSmallSwapRoundWithFeeTracking(poolKey, poolId, trader);
        _runSmallSwapRound(plainPoolKey, trader);
    }

    function _buildReports(
        ComparisonArbPhase memory arb,
        FeeAccruedParser.Totals memory hookedFeesRound1,
        FeeAccruedParser.Totals memory hookedFeesRound2
    ) internal returns (ComparisonReports memory reports) {
        uint256 finalPrice = TestConstants.ETH_USDT_PRICE_SCALED_TARGET;

        FeeAccruedParser.Totals memory hookedSwapFees =
            FeeAccruedParser.merge(hookedFeesRound1, hookedFeesRound2);
        reports.hookedSwapFees = FeeAccruedParser.valueInUsdt(hookedSwapFees, finalPrice);

        PoolComparisonTypes.LpSnapshot memory plainFinalLp = _burnLpPosition(plainPoolKey, plainLpLiquidity);
        plainFinalLp.valueUsdt = _valueAtPrice(plainFinalLp.weth, plainFinalLp.usdt, finalPrice);

        PoolComparisonTypes.LpSnapshot memory hookedFinalLp = _burnLpPosition(poolKey, hookedLpLiquidity);
        hookedFinalLp.valueUsdt = _valueAtPrice(hookedFinalLp.weth, hookedFinalLp.usdt, finalPrice);

        PoolComparisonTypes.LpSnapshot memory initialLp =
            PoolComparisonTypes.LpSnapshot({weth: LP_WETH, usdt: _lpUsdtAmount(), valueUsdt: 0});

        reports.plain = PoolComparisonTypes.SideReport({
            initialLp: initialLp,
            finalLp: plainFinalLp,
            swapFeesToLpUsdt: _estimatePlainSwapFeesUsdt(finalPrice),
            arbProfitUsdt: arb.plainArbProfit,
            poolDonationUsdt: 0,
            keeperPayoutUsdt: 0,
            treasuryClaimableUsdt: 0,
            treasuryClaimableWethUsdt: 0,
            treasuryTotalUsdt: 0
        });

        (uint256 treasuryUsdt, uint256 treasuryWethUsdt, uint256 treasuryTotalUsdt) =
            _syncKeeperTreasuryInUsdt(finalPrice);

        reports.hooked = PoolComparisonTypes.SideReport({
            initialLp: initialLp,
            finalLp: hookedFinalLp,
            swapFeesToLpUsdt: reports.hookedSwapFees.lpShareUsdt,
            arbProfitUsdt: arb.hookedKeeperPayout,
            poolDonationUsdt: arb.hookedDonation,
            keeperPayoutUsdt: arb.hookedKeeperPayout,
            treasuryClaimableUsdt: treasuryUsdt,
            treasuryClaimableWethUsdt: treasuryWethUsdt,
            treasuryTotalUsdt: treasuryTotalUsdt
        });
    }

    function _logReports(ComparisonReports memory reports) internal view {
        _logPlainReport(reports.plain);
        _logHookedReport(reports.hooked, reports.hookedSwapFees);
    }

    function _assertComparisonOutcome(ComparisonArbPhase memory arb) internal view {
        uint256 finalPrice = TestConstants.ETH_USDT_PRICE_SCALED_TARGET;

        assertGt(arb.plainArbProfit, 0, "plain arb profit");
        assertGt(arb.hookedKeeperPayout, 0, "hooked keeper payout");
        assertGt(arb.hookedDonation, 0, "hooked pool donation");
        assertApproxEqAbs(_poolPriceScaled(poolKey), finalPrice, 5e7, "hooked pool synced");
        assertApproxEqAbs(_poolPriceScaled(plainPoolKey), finalPrice, 5e7, "plain pool synced");
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
