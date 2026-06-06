// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {DynamicFeeHook} from "src/hooks/DynamicFeeHook.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolConfigBuilder} from "test/helpers/config/PoolConfigBuilder.t.sol";
import {CoreSystem, CoreSystemDeployer} from "test/helpers/deploy/CoreSystemDeployer.t.sol";
import {PoolDeployer} from "test/helpers/deploy/PoolDeployer.t.sol";
import {ForkTest} from "test/helpers/fork/ForkTest.t.sol";
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

}
