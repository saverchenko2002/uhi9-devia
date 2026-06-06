// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {DynamicFeeHook} from "src/hooks/DynamicFeeHook.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {DonateMode, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolConfigBuilder} from "test/helpers/config/PoolConfigBuilder.t.sol";
import {CoreSystem, CoreSystemDeployer} from "test/helpers/deploy/CoreSystemDeployer.t.sol";
import {PoolDeployer} from "test/helpers/deploy/PoolDeployer.t.sol";
import {ForkTest} from "test/helpers/fork/ForkTest.t.sol";
import {KeeperExtensionBuilder} from "test/helpers/keeper/KeeperExtensionBuilder.t.sol";
import {PoolLiquidityRouter} from "test/helpers/liquidity/PoolLiquidityRouter.t.sol";
import {PythTestHelper} from "test/helpers/pyth/PythTestHelper.t.sol";
import {MockRouter} from "test/mocks/MockRouter.t.sol";

abstract contract ExecuteWithIntentTestBase is ForkTest {

    using SafeERC20 for IERC20;

    CoreSystem internal sys;
    address internal hook;
    PoolKey internal poolKey;
    bytes32 internal poolId;
    PoolLiquidityRouter internal liqRouter;
    MockRouter internal mockRouter;

    address internal owner = makeAddr("owner");
    address internal syncKeeper = makeAddr("syncKeeper");
    address internal lp = makeAddr("lp");

    function _setUpSyncPool() internal {
        sys = CoreSystemDeployer.deploy(owner, poolManager, IPyth(address(mockPyth)));

        hook = _deployDynamicFeeHook(
            sys.registry, sys.feedKeepers, sys.syncKeepers, sys.keepersTreasury, sys.executor
        );

        _wireHookSystem(
            hook,
            sys.feedKeepers,
            sys.syncKeepers,
            sys.registry,
            sys.keepersTreasury,
            sys.executor,
            owner
        );

        liqRouter = new PoolLiquidityRouter(poolManager);
        mockRouter = new MockRouter();

        (poolKey, poolId) =
            PoolDeployer.createWethUsdtPool(poolManager, hook, PoolDeployer.wethUsdtSqrtPriceX96());

        vm.prank(owner);
        sys.registry.updatePoolConfig(poolId, PoolConfigBuilder.defaultEthUsdtPool());

        PythTestHelper.seedEthUsdtPrice(mockPyth, uint64(block.timestamp));

        _seedPoolLiquidity();
    }

    function _seedPoolLiquidity() internal {
        uint256 amount0 = TestConstants.SYNC_TEST_LP_WETH;
        uint256 amount1 = TestConstants.syncTestLpUsdtAmount();

        deal(TestConstants.WETH, lp, amount0);
        deal(TestConstants.USDT, lp, amount1);

        vm.startPrank(lp);
        IERC20(TestConstants.WETH).approve(address(liqRouter), amount0);
        IERC20(TestConstants.USDT).forceApprove(address(liqRouter), amount1);

        liqRouter.addLiquidityFromAmounts(
            poolKey,
            TestConstants.syncTestFullRangeTickLower(),
            TestConstants.syncTestFullRangeTickUpper(),
            PoolDeployer.wethUsdtSqrtPriceX96(),
            amount0,
            amount1,
            lp
        );
        vm.stopPrank();
    }

    function _targetPrice() internal pure returns (uint256) {
        return TestConstants.ETH_USDT_PRICE_SCALED_TARGET;
    }

    function _previewSync() internal view returns (IKeeperExecutor.SyncPreview memory) {
        return sys.executor.previewSync(poolId, _targetPrice(), TestConstants.PRICE_DECIMALS);
    }

    function _previewSyncAt(uint256 targetPrice)
        internal
        view
        returns (IKeeperExecutor.SyncPreview memory)
    {
        return sys.executor.previewSync(poolId, targetPrice, TestConstants.PRICE_DECIMALS);
    }

    function _packMockRouterSwap(address tokenOut, uint256 amountOut, uint256 routerUsdtOut)
        internal
        view
        returns (bytes memory)
    {
        return mockRouter.packSwapCalldata(tokenOut, amountOut, TestConstants.USDT, routerUsdtOut);
    }

    function _encodeSyncExtension(bytes memory externalSwap) internal pure returns (bytes memory) {
        return _encodeSyncExtensionAt(TestConstants.ETH_USDT_PRICE_SCALED_TARGET, externalSwap);
    }

    function _encodeSyncExtensionAt(uint256 targetPrice, bytes memory externalSwap)
        internal
        pure
        returns (bytes memory)
    {
        return _encodeSyncExtensionWithTraitsAt(
            targetPrice, externalSwap, DonateMode.MIN_ONLY, 0, PayoutMode.WRAPPED, address(0)
        );
    }

    function _encodeSyncExtensionWithTraits(
        bytes memory externalSwap,
        DonateMode donateMode,
        uint16 donateParam,
        PayoutMode payoutType,
        address recipient
    ) internal pure returns (bytes memory) {
        return KeeperExtensionBuilder.encodeSyncWithExternal(
            TestConstants.ETH_USDT_PRICE_SCALED_TARGET,
            TestConstants.PRICE_DECIMALS,
            externalSwap,
            donateMode,
            donateParam,
            payoutType,
            recipient
        );
    }

    function _encodeSyncExtensionWithTraitsAt(
        uint256 targetPrice,
        bytes memory externalSwap,
        DonateMode donateMode,
        uint16 donateParam,
        PayoutMode payoutType,
        address recipient
    ) internal pure returns (bytes memory) {
        return KeeperExtensionBuilder.encodeSyncWithExternal(
            targetPrice,
            TestConstants.PRICE_DECIMALS,
            externalSwap,
            donateMode,
            donateParam,
            payoutType,
            recipient
        );
    }

    function _buildIntent(
        IKeeperExecutor.SyncPreview memory preview,
        bytes memory extension,
        uint256 capitalAmount,
        uint256 expectedProfit,
        address capitalToken,
        address profitToken
    ) internal view returns (IKeeperExecutor.KeeperIntent memory) {
        return IKeeperExecutor.KeeperIntent({
            poolId: poolId,
            capitalToken: capitalToken,
            capitalAmount: capitalAmount,
            profitToken: profitToken,
            expectedProfit: expectedProfit,
            extension: extension
        });
    }

    function _buildArbIntentWithTraits(
        uint256 routerUsdtOut,
        DonateMode donateMode,
        uint16 donateParam,
        PayoutMode payoutType,
        address recipient
    )
        internal
        view
        returns (
            IKeeperExecutor.KeeperIntent memory intent,
            IKeeperExecutor.SyncPreview memory preview
        )
    {
        preview = _previewSync();
        uint256 capitalAmount = preview.poolInputToReachTarget;
        uint256 expectedProfit = routerUsdtOut - capitalAmount;
        bytes memory externalSwap = _packMockRouterSwap(
            preview.poolSwapTokenOut, preview.poolOutputToReachTarget, routerUsdtOut
        );
        bytes memory extension = _encodeSyncExtensionWithTraits(
            externalSwap, donateMode, donateParam, payoutType, recipient
        );
        intent = _buildIntent(
            preview,
            extension,
            capitalAmount,
            expectedProfit,
            preview.poolSwapTokenIn,
            TestConstants.USDT
        );
    }

    function _buildValidArbIntent(uint256 routerUsdtOut)
        internal
        view
        returns (
            IKeeperExecutor.KeeperIntent memory intent,
            IKeeperExecutor.SyncPreview memory preview
        )
    {
        preview = _previewSync();
        uint256 capitalAmount = preview.poolInputToReachTarget;
        uint256 expectedProfit = routerUsdtOut - capitalAmount;
        bytes memory externalSwap = _packMockRouterSwap(
            preview.poolSwapTokenOut, preview.poolOutputToReachTarget, routerUsdtOut
        );
        bytes memory extension = _encodeSyncExtension(externalSwap);
        intent = _buildIntent(
            preview,
            extension,
            capitalAmount,
            expectedProfit,
            preview.poolSwapTokenIn,
            TestConstants.USDT
        );
    }

    function _executeIntentReturns(
        IKeeperExecutor.KeeperIntent memory intent,
        uint256 routerUsdtOut
    )
        internal
        returns (
            uint256 actualProfit,
            uint256 donationAmount,
            uint256 keeperPayout,
            uint256 capitalReturned
        )
    {
        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);
        deal(intent.capitalToken, syncKeeper, intent.capitalAmount);
        vm.startPrank(syncKeeper);
        IERC20(intent.capitalToken).forceApprove(address(sys.executor), intent.capitalAmount);
        (actualProfit, donationAmount, keeperPayout, capitalReturned) =
            sys.executor.executeWithIntent(intent);
        vm.stopPrank();
    }

    function _executeIntent(IKeeperExecutor.KeeperIntent memory intent, uint256 routerUsdtOut)
        internal
    {
        _executeIntentReturns(intent, routerUsdtOut);
    }

    function _fairRouterUsdtOut(IKeeperExecutor.SyncPreview memory preview)
        internal
        pure
        returns (uint256)
    {
        return TestConstants.usdtForWethAtPrice(
            preview.poolOutputToReachTarget, TestConstants.ETH_USDT_PRICE_SCALED_TARGET
        );
    }

    function _minRequiredDonation(uint256 actualProfit) internal view returns (uint256) {
        uint16 minDonateBps = sys.registry.getPoolConfig(poolId).minDonateBps;
        if (minDonateBps == 0 || actualProfit == 0) return 0;
        return (actualProfit * minDonateBps) / PoolConfigLib.BPS;
    }

}
