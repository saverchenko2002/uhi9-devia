// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {DynamicFeeHook} from "src/hooks/DynamicFeeHook.sol";
import {PoolConfigBuilder} from "test/helpers/config/PoolConfigBuilder.t.sol";
import {CoreSystem, CoreSystemDeployer} from "test/helpers/deploy/CoreSystemDeployer.t.sol";
import {PoolDeployer} from "test/helpers/deploy/PoolDeployer.t.sol";
import {ForkTest} from "test/helpers/fork/ForkTest.t.sol";

/// @dev Shared fork fixture for `executeFeedOnly` integration tests.
abstract contract ExecuteFeedOnlyTestBase is ForkTest {

    CoreSystem internal sys;
    address internal hook;
    bytes32 internal poolId;
    address internal owner = makeAddr("owner");
    address internal keeper = makeAddr("feedKeeper");

    function _setUpFeedPool(bool withPriceFeedId) internal {
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

        (, poolId) =
            PoolDeployer.createWethUsdtPool(poolManager, hook, PoolDeployer.wethUsdtSqrtPriceX96());

        if (withPriceFeedId) {
            vm.prank(owner);
            sys.registry.updatePoolConfig(poolId, PoolConfigBuilder.defaultEthUsdtPool());
        }
    }

}
