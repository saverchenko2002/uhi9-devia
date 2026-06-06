// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {DonateMode, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {KeeperExtensionBuilder} from "test/helpers/keeper/KeeperExtensionBuilder.t.sol";
import {
    ExecuteWithIntentTestBase
} from "test/integration/core/KeeperExecutor/base/ExecuteWithIntentTestBase.t.sol";

contract KeeperExecutor_ExecuteWithIntent_Test is ExecuteWithIntentTestBase {

    using SafeERC20 for IERC20;

    function setUp() public override {
        super.setUp();
        _setUpSyncPool();
    }

    function test_executeWithIntent_syncWithMockRouter() public {
        uint256 targetPrice = TestConstants.ETH_USDT_PRICE_SCALED_TARGET;
        IKeeperExecutor.SyncPreview memory preview =
            sys.executor.previewSync(poolId, targetPrice, TestConstants.PRICE_DECIMALS);

        assertGt(preview.poolInputToReachTarget, 0);
        assertGt(preview.poolOutputToReachTarget, 0);
        assertGt(preview.poolDeviationBps, 0);

        uint256 capitalAmount = preview.poolInputToReachTarget;
        uint256 wethOut = preview.poolOutputToReachTarget;
        // MockRouter = external DEX at targetPrice: sell WETH → USDT.
        uint256 routerUsdtOut = TestConstants.usdtForWethAtPrice(wethOut, targetPrice);
        // capitalToken == profitToken (USDT): profit = USDT back from router − USDT spent in pool.
        uint256 expectedProfit = routerUsdtOut - capitalAmount;

        assertGt(expectedProfit, 0, "arb profit must be positive at targetPrice");

        bytes memory externalSwap = mockRouter.packSwapCalldata(
            preview.poolSwapTokenOut, wethOut, TestConstants.USDT, routerUsdtOut
        );

        bytes memory extension = KeeperExtensionBuilder.encodeSyncWithExternal(
            targetPrice,
            TestConstants.PRICE_DECIMALS,
            externalSwap,
            DonateMode.MIN_ONLY,
            0,
            PayoutMode.WRAPPED,
            address(0)
        );

        IKeeperExecutor.KeeperIntent memory intent = IKeeperExecutor.KeeperIntent({
            poolId: poolId,
            capitalToken: preview.poolSwapTokenIn,
            capitalAmount: capitalAmount,
            profitToken: TestConstants.USDT,
            expectedProfit: expectedProfit,
            extension: extension
        });

        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        deal(TestConstants.USDT, syncKeeper, capitalAmount);

        vm.startPrank(syncKeeper);
        IERC20(TestConstants.USDT).forceApprove(address(sys.executor), capitalAmount);
        (
            uint256 actualProfit,
            uint256 donationAmount,
            uint256 keeperPayout,
            uint256 capitalReturned
        ) = sys.executor.executeWithIntent(intent);
        vm.stopPrank();

        assertGe(actualProfit, expectedProfit);
        assertGt(donationAmount, 0);
        assertEq(keeperPayout, actualProfit - donationAmount);
        assertGt(capitalReturned, 0);

        (address activeKeeper, uint32 qualityBps, uint32 windowEndBlock, bool isActive) =
            sys.syncKeepers.getActiveSyncKeeper(poolId);

        assertEq(activeKeeper, syncKeeper);
        assertTrue(isActive);
        assertGt(qualityBps, 0);
        assertGt(windowEndBlock, block.number);
    }

}
