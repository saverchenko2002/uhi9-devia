// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {DonateMode, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {
    ExecuteWithIntentTestBase
} from "test/integration/core/KeeperExecutor/base/ExecuteWithIntentTestBase.t.sol";

contract KeeperExecutor_ExecuteWithIntent_DonationPayout_Test is ExecuteWithIntentTestBase {

    function setUp() public override {
        super.setUp();
        _setUpSyncPool();
    }

    function test_donateModeMinOnly_donatesPoolMinimum() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut = _fairRouterUsdtOut(preview);

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildArbIntentWithTraits(
            routerUsdtOut, DonateMode.MIN_ONLY, 0, PayoutMode.WRAPPED, address(0)
        );

        (uint256 actualProfit, uint256 donationAmount, uint256 keeperPayout,) =
            _executeIntentReturns(intent, routerUsdtOut);

        uint256 minDonation = _minRequiredDonation(actualProfit);
        assertGt(actualProfit, 0);
        assertEq(donationAmount, minDonation);
        assertEq(keeperPayout, actualProfit - minDonation);
    }

    function test_donateModeAll_donatesFullProfit() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut = _fairRouterUsdtOut(preview);

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildArbIntentWithTraits(
            routerUsdtOut, DonateMode.ALL, 0, PayoutMode.WRAPPED, address(0)
        );

        (uint256 actualProfit, uint256 donationAmount, uint256 keeperPayout,) =
            _executeIntentReturns(intent, routerUsdtOut);

        assertEq(donationAmount, actualProfit);
        assertEq(keeperPayout, 0);
    }

    function test_donateModeSpecifiedBps_splitsProfit() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut = _fairRouterUsdtOut(preview);
        uint16 donateBps = 8000;

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildArbIntentWithTraits(
            routerUsdtOut, DonateMode.SPECIFIED_BPS, donateBps, PayoutMode.WRAPPED, address(0)
        );

        (uint256 actualProfit, uint256 donationAmount, uint256 keeperPayout,) =
            _executeIntentReturns(intent, routerUsdtOut);

        uint256 expectedDonation = actualProfit * donateBps / TestConstants.BPS;
        assertEq(donationAmount, expectedDonation);
        assertEq(keeperPayout, actualProfit - expectedDonation);
    }

    function test_payoutModeTreasuryDeposit_creditsTreasuryNotWallet() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut = _fairRouterUsdtOut(preview);

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildArbIntentWithTraits(
            routerUsdtOut, DonateMode.MIN_ONLY, 0, PayoutMode.TREASURY_DEPOSIT, address(0)
        );

        uint256 keeperUsdtBefore = IERC20(TestConstants.USDT).balanceOf(syncKeeper);
        uint256 treasuryBefore = sys.keepersTreasury.claimable(syncKeeper, TestConstants.USDT);

        (
            uint256 actualProfit,
            uint256 donationAmount,
            uint256 keeperPayout,
            uint256 capitalReturned
        ) = _executeIntentReturns(intent, routerUsdtOut);

        uint256 keeperUsdtAfter = IERC20(TestConstants.USDT).balanceOf(syncKeeper);
        uint256 treasuryAfter = sys.keepersTreasury.claimable(syncKeeper, TestConstants.USDT);

        assertEq(keeperPayout, actualProfit - donationAmount);
        assertEq(treasuryAfter - treasuryBefore, keeperPayout);
        assertEq(keeperUsdtAfter - keeperUsdtBefore, capitalReturned);
        assertEq(keeperUsdtAfter - keeperUsdtBefore, intent.capitalAmount);
    }

}
