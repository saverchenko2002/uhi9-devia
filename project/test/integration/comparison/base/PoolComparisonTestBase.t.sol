// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PoolSyncLib} from "src/libs/PoolSyncLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolComparisonTypes} from "test/helpers/comparison/PoolComparisonTypes.t.sol";
import {PoolDeployer} from "test/helpers/deploy/PoolDeployer.t.sol";
import {FeeAccruedParser} from "test/helpers/fee/FeeAccruedParser.t.sol";
import {PythTestHelper} from "test/helpers/pyth/PythTestHelper.t.sol";
import {PoolSwapRouter} from "test/helpers/swap/PoolSwapRouter.t.sol";
import {
    ExecuteWithIntentTestBase
} from "test/integration/core/KeeperExecutor/base/ExecuteWithIntentTestBase.t.sol";

/// @dev Shared fixture: hooked DynamicFee pool + plain static-fee v4 pool at the same initial price.
abstract contract PoolComparisonTestBase is ExecuteWithIntentTestBase {

    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolKey internal plainPoolKey;
    bytes32 internal plainPoolId;

    PoolSwapRouter internal swapRouter;

    address internal plainArb = makeAddr("plainArb");
    address internal trader = makeAddr("trader");

    uint128 internal hookedLpLiquidity;
    uint128 internal plainLpLiquidity;

    uint256 internal constant SMALL_WETH_SWAP = 0.1 ether;
    uint256 internal constant SMALL_USDT_SWAP = 300e6;

    uint256 internal constant LP_WETH = TestConstants.SYNC_TEST_LP_WETH;

    function _lpUsdtAmount() internal pure returns (uint256) {
        return TestConstants.syncTestLpUsdtAmount();
    }

    function setUp() public virtual override {
        super.setUp();
        _setUpSyncPool();
        swapRouter = new PoolSwapRouter(poolManager);
        _setUpPlainPool();
        hookedLpLiquidity = _computeFullRangeLiquidity(poolKey);
        plainLpLiquidity = _seedPlainPoolLiquidity();
    }

    function _setUpPlainPool() internal {
        (plainPoolKey, plainPoolId) =
            PoolDeployer.createPlainWethUsdtPool(poolManager, PoolDeployer.wethUsdtSqrtPriceX96());
    }

    function _computeFullRangeLiquidity(PoolKey memory key)
        internal
        view
        returns (uint128 liquidity)
    {
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            _sqrtPrice(key),
            TickMath.getSqrtPriceAtTick(TestConstants.syncTestFullRangeTickLower()),
            TickMath.getSqrtPriceAtTick(TestConstants.syncTestFullRangeTickUpper()),
            LP_WETH,
            _lpUsdtAmount()
        );
    }

    function _seedPlainPoolLiquidity() internal returns (uint128 liquidity) {
        liquidity = _computeFullRangeLiquidity(plainPoolKey);

        deal(TestConstants.WETH, lp, LP_WETH);
        deal(TestConstants.USDT, lp, _lpUsdtAmount());

        vm.startPrank(lp);
        IERC20(TestConstants.WETH).approve(address(liqRouter), LP_WETH);
        IERC20(TestConstants.USDT).forceApprove(address(liqRouter), _lpUsdtAmount());

        liqRouter.addLiquidityFromAmounts(
            plainPoolKey,
            TestConstants.syncTestFullRangeTickLower(),
            TestConstants.syncTestFullRangeTickUpper(),
            PoolDeployer.wethUsdtSqrtPriceX96(),
            LP_WETH,
            _lpUsdtAmount(),
            lp
        );
        vm.stopPrank();
    }

    function _seedOracleAtTarget() internal {
        vm.warp(block.timestamp + 1);
        PythTestHelper.seedEthUsdtPriceAt(
            mockPyth,
            int64(uint64(TestConstants.ETH_USDT_PRICE_SCALED_TARGET)),
            uint64(block.timestamp)
        );
    }

    function _runSmallSwapRound(PoolKey memory key, address swapper) internal {
        _swapExactIn(key, true, SMALL_WETH_SWAP, swapper);
        _swapExactIn(key, true, SMALL_WETH_SWAP, swapper);
        _swapExactIn(key, false, SMALL_USDT_SWAP, swapper);
        _swapExactIn(key, false, SMALL_USDT_SWAP, swapper);
    }

    function _runSmallSwapRoundWithFeeTracking(
        PoolKey memory key,
        bytes32 trackedPoolId,
        address swapper
    ) internal returns (FeeAccruedParser.Totals memory fees) {
        vm.recordLogs();
        _runSmallSwapRound(key, swapper);
        fees = FeeAccruedParser.accumulate(vm.getRecordedLogs(), trackedPoolId, fees);
    }

    function _swapExactIn(PoolKey memory key, bool zeroForOne, uint256 amountIn, address payer)
        internal
    {
        (address tokenIn, address tokenOut) = zeroForOne
            ? (TestConstants.WETH, TestConstants.USDT)
            : (TestConstants.USDT, TestConstants.WETH);

        deal(tokenIn, payer, amountIn);
        vm.startPrank(payer);
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        swapRouter.swapExactIn(key, zeroForOne, amountIn, "", payer);
        vm.stopPrank();
    }

    function _executeHookedSyncArb()
        internal
        returns (uint256 actualProfit, uint256 donationAmount, uint256 keeperPayout)
    {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut = _fairRouterUsdtOut(preview);
        (IKeeperExecutor.KeeperIntent memory intent,) = _buildValidArbIntent(routerUsdtOut);

        (actualProfit, donationAmount, keeperPayout,) = _executeIntentReturns(intent, routerUsdtOut);
    }

    function _executePlainPoolArb() internal returns (uint256 profitUsdt) {
        PoolConfig memory cfg = sys.registry.getPoolConfig(poolId);
        PriceScale memory scale =
            PoolPriceLib.priceScaleFromPoolKey(plainPoolKey, TestConstants.PRICE_DECIMALS);

        PoolSyncLib.QuoteToTargetPlan memory plan = PoolSyncLib.planQuoteSwapToTarget(
            plainPoolId, poolManager, TestConstants.ETH_USDT_PRICE_SCALED_TARGET, cfg, scale
        );

        uint256 capitalUsdt = plan.amountIn;

        deal(TestConstants.USDT, plainArb, capitalUsdt);

        vm.startPrank(plainArb);
        IERC20(TestConstants.USDT).forceApprove(address(swapRouter), capitalUsdt);
        uint256 actualWethOut =
            swapRouter.swapExactIn(plainPoolKey, plan.zeroForOne, capitalUsdt, "", plainArb);

        uint256 routerUsdtOut = TestConstants.usdtForWethAtPrice(
            actualWethOut, TestConstants.ETH_USDT_PRICE_SCALED_TARGET
        );
        deal(TestConstants.USDT, address(mockRouter), routerUsdtOut);

        IERC20(TestConstants.WETH).forceApprove(address(mockRouter), actualWethOut);
        mockRouter.simulateArb(TestConstants.WETH, actualWethOut, TestConstants.USDT, routerUsdtOut);
        vm.stopPrank();

        profitUsdt = routerUsdtOut - capitalUsdt;
    }

    function _depositSnapshot(uint256 priceScaled)
        internal
        pure
        returns (PoolComparisonTypes.LpSnapshot memory snapshot)
    {
        snapshot.weth = LP_WETH;
        snapshot.usdt = _lpUsdtAmount();
        snapshot.valueUsdt = _valueAtPrice(LP_WETH, _lpUsdtAmount(), priceScaled);
    }

    function _lpSnapshot(address provider, uint256 priceScaled)
        internal
        view
        returns (PoolComparisonTypes.LpSnapshot memory snapshot)
    {
        snapshot.weth = IERC20(TestConstants.WETH).balanceOf(provider);
        snapshot.usdt = IERC20(TestConstants.USDT).balanceOf(provider);
        snapshot.valueUsdt = _valueAtPrice(snapshot.weth, snapshot.usdt, priceScaled);
    }

    function _burnLpPosition(PoolKey memory key, uint128 liquidity)
        internal
        returns (PoolComparisonTypes.LpSnapshot memory withdrawn)
    {
        uint256 wethBefore = IERC20(TestConstants.WETH).balanceOf(lp);
        uint256 usdtBefore = IERC20(TestConstants.USDT).balanceOf(lp);

        vm.prank(lp);
        liqRouter.removeAllLiquidity(
            key,
            TestConstants.syncTestFullRangeTickLower(),
            TestConstants.syncTestFullRangeTickUpper(),
            liquidity,
            lp
        );

        withdrawn.weth = IERC20(TestConstants.WETH).balanceOf(lp) - wethBefore;
        withdrawn.usdt = IERC20(TestConstants.USDT).balanceOf(lp) - usdtBefore;
    }

    function _valueAtPrice(uint256 wethAmount, uint256 usdtAmount, uint256 priceScaled)
        internal
        pure
        returns (uint256)
    {
        return TestConstants.usdtForWethAtPrice(wethAmount, priceScaled) + usdtAmount;
    }

    function _poolPriceScaled(PoolKey memory key) internal view returns (uint256) {
        PriceScale memory scale =
            PoolPriceLib.priceScaleFromPoolKey(key, TestConstants.PRICE_DECIMALS);
        return PoolPriceLib.priceScaledFromSqrtPriceX96(_sqrtPrice(key), scale);
    }

    function _estimatePlainSwapFeesUsdt(uint256 priceScaled)
        internal
        pure
        returns (uint256 feesUsdt)
    {
        uint256 wethLegValue = TestConstants.usdtForWethAtPrice(SMALL_WETH_SWAP, priceScaled);
        uint256 perRound = (2 * wethLegValue + 2 * SMALL_USDT_SWAP)
            * uint256(PoolDeployer.plainPoolStaticFee()) / 1_000_000;
        feesUsdt = perRound * 2;
    }

    function _syncKeeperTreasuryInUsdt(uint256 priceScaled)
        internal
        view
        returns (uint256 claimableUsdt, uint256 claimableWethInUsdt, uint256 totalUsdt)
    {
        claimableUsdt = sys.keepersTreasury.claimable(syncKeeper, TestConstants.USDT);
        uint256 claimableWeth = sys.keepersTreasury.claimable(syncKeeper, TestConstants.WETH);
        claimableWethInUsdt = TestConstants.usdtForWethAtPrice(claimableWeth, priceScaled);
        totalUsdt = claimableUsdt + claimableWethInUsdt;
    }

    function _sqrtPrice(PoolKey memory key) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
    }

}
