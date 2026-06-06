// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {KeeperExecutor} from "src/core/KeeperExecutor.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {KeeperSyncLib} from "src/libs/KeeperSyncLib.sol";
import {DonateMode, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolConfigBuilder} from "test/helpers/config/PoolConfigBuilder.t.sol";
import {KeeperExtensionBuilder} from "test/helpers/keeper/KeeperExtensionBuilder.t.sol";
import {PythTestHelper} from "test/helpers/pyth/PythTestHelper.t.sol";
import {
    ExecuteWithIntentTestBase
} from "test/integration/core/KeeperExecutor/base/ExecuteWithIntentTestBase.t.sol";
import {RevertingCallTarget} from "test/mocks/RevertingCallTarget.t.sol";

contract KeeperExecutor_ExecuteWithIntent_Reverts_Test is ExecuteWithIntentTestBase {

    using SafeERC20 for IERC20;

    RevertingCallTarget internal revertingTarget;

    function setUp() public override {
        super.setUp();
        _setUpSyncPool();
        revertingTarget = new RevertingCallTarget();
    }

    function test_revertsOnMissingExternalSettlement() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        bytes memory extension = _encodeSyncExtension("");

        IKeeperExecutor.KeeperIntent memory intent = _buildIntent(
            preview,
            extension,
            preview.poolInputToReachTarget,
            1,
            preview.poolSwapTokenIn,
            TestConstants.USDT
        );

        deal(TestConstants.USDT, syncKeeper, intent.capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), intent.capitalAmount);
        vm.expectRevert(KeeperSyncLib.ExternalSettlementRequired.selector);
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnSyncActionRequired() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        bytes memory feedPayload = PythTestHelper.ethUsdtUpdate(uint64(block.timestamp));
        bytes memory extension = KeeperExtensionBuilder.encodeFeedOnly(
            feedPayload, DonateMode.MIN_ONLY, 0, PayoutMode.WRAPPED, address(0)
        );

        IKeeperExecutor.KeeperIntent memory intent = _buildIntent(
            preview,
            extension,
            preview.poolInputToReachTarget,
            0,
            preview.poolSwapTokenIn,
            TestConstants.USDT
        );

        deal(TestConstants.USDT, syncKeeper, intent.capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), intent.capitalAmount);
        vm.expectRevert(KeeperExecutor.SyncActionRequired.selector);
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnInsufficientCapital() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 capitalAmount = preview.poolInputToReachTarget;
        uint256 routerUsdtOut =
            TestConstants.usdtForWethAtPrice(preview.poolOutputToReachTarget, _targetPrice());

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildValidArbIntent(routerUsdtOut);
        intent.capitalAmount = capitalAmount - 1;

        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        deal(TestConstants.USDT, syncKeeper, intent.capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), intent.capitalAmount);
        vm.expectRevert(
            abi.encodeWithSelector(
                KeeperExecutor.InsufficientCapital.selector, capitalAmount, capitalAmount - 1
            )
        );
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnCapitalTokenMismatch() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut =
            TestConstants.usdtForWethAtPrice(preview.poolOutputToReachTarget, _targetPrice());

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildValidArbIntent(routerUsdtOut);
        intent.capitalToken = TestConstants.WETH;

        deal(TestConstants.WETH, syncKeeper, intent.capitalAmount);
        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        vm.startPrank(syncKeeper);
        IERC20(TestConstants.WETH).forceApprove(address(sys.executor), intent.capitalAmount);
        vm.expectRevert(
            abi.encodeWithSelector(
                KeeperExecutor.CapitalTokenMismatch.selector,
                preview.poolSwapTokenIn,
                TestConstants.WETH
            )
        );
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnNonPositiveArbProfit() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 capitalAmount = preview.poolInputToReachTarget;
        uint256 routerUsdtOut = capitalAmount;

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildValidArbIntent(routerUsdtOut);
        intent.expectedProfit = 1;

        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        deal(TestConstants.USDT, syncKeeper, capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), capitalAmount);
        vm.expectRevert(
            abi.encodeWithSelector(KeeperExecutor.NonPositiveArbProfit.selector, uint256(0))
        );
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnSyncSlippageTooHigh() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        PoolConfig memory cfg = PoolConfigBuilder.defaultEthUsdtPool();
        uint256 capitalAmount = preview.poolInputToReachTarget;
        uint256 fairRouterUsdtOut =
            TestConstants.usdtForWethAtPrice(preview.poolOutputToReachTarget, _targetPrice());
        uint256 expectedProfit = fairRouterUsdtOut - capitalAmount;
        // Router pays 99% of fair quote → 100 bps slippage vs maxSlippageBps = 50.
        uint256 routerUsdtOut = capitalAmount + (expectedProfit * 9900) / TestConstants.BPS;
        uint256 actualProfit = routerUsdtOut - capitalAmount;
        uint256 slippageBps = (expectedProfit - actualProfit) * TestConstants.BPS / expectedProfit;

        bytes memory externalSwap = _packMockRouterSwap(
            preview.poolSwapTokenOut, preview.poolOutputToReachTarget, routerUsdtOut
        );
        bytes memory extension = _encodeSyncExtension(externalSwap);
        IKeeperExecutor.KeeperIntent memory intent = _buildIntent(
            preview,
            extension,
            capitalAmount,
            expectedProfit,
            preview.poolSwapTokenIn,
            TestConstants.USDT
        );

        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        deal(TestConstants.USDT, syncKeeper, capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), capitalAmount);
        vm.expectRevert(
            abi.encodeWithSelector(
                KeeperSyncLib.SyncSlippageTooHigh.selector, slippageBps, cfg.maxSlippageBps
            )
        );
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnExecutionCallFailed() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 capitalAmount = preview.poolInputToReachTarget;
        uint256 routerUsdtOut =
            TestConstants.usdtForWethAtPrice(preview.poolOutputToReachTarget, _targetPrice());

        bytes memory externalSwap = abi.encodePacked(
            address(revertingTarget), abi.encodeCall(RevertingCallTarget.alwaysRevert, ())
        );
        bytes memory extension = _encodeSyncExtension(externalSwap);
        IKeeperExecutor.KeeperIntent memory intent = _buildIntent(
            preview,
            extension,
            capitalAmount,
            routerUsdtOut - capitalAmount,
            preview.poolSwapTokenIn,
            TestConstants.USDT
        );

        deal(TestConstants.USDT, syncKeeper, capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), capitalAmount);
        vm.expectRevert(KeeperExecutor.ExecutionCallFailed.selector);
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnImprovementTooSmall() public {
        PoolConfig memory cfg = PoolConfigBuilder.defaultEthUsdtPool();
        cfg.minImprovementBps = TestConstants.BPS;
        vm.prank(owner);
        sys.registry.updatePoolConfig(poolId, cfg);

        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut =
            TestConstants.usdtForWethAtPrice(preview.poolOutputToReachTarget, _targetPrice());

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildValidArbIntent(routerUsdtOut);

        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        deal(TestConstants.USDT, syncKeeper, intent.capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), intent.capitalAmount);
        vm.expectRevert(
            abi.encodeWithSelector(
                KeeperSyncLib.ImprovementTooSmall.selector,
                preview.poolDeviationBps,
                cfg.minImprovementBps
            )
        );
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function test_revertsOnTokenNotInPool() public {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut =
            TestConstants.usdtForWethAtPrice(preview.poolOutputToReachTarget, _targetPrice());

        (IKeeperExecutor.KeeperIntent memory intent,) = _buildValidArbIntent(routerUsdtOut);
        address badProfitToken = makeAddr("badProfitToken");
        intent.profitToken = badProfitToken;

        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        deal(TestConstants.USDT, syncKeeper, intent.capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), intent.capitalAmount);
        vm.expectRevert(
            abi.encodeWithSelector(
                KeeperExecutor.TokenNotInPool.selector,
                badProfitToken,
                TestConstants.WETH,
                TestConstants.USDT
            )
        );
        sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

}
