// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";

import {KeeperExecutor} from "src/core/KeeperExecutor.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PoolConfigBuilder} from "test/helpers/config/PoolConfigBuilder.t.sol";
import {PythTestHelper} from "test/helpers/pyth/PythTestHelper.t.sol";
import {
    ExecuteFeedOnlyTestBase
} from "test/integration/core/KeeperExecutor/ExecuteFeedOnlyTestBase.t.sol";

contract KeeperExecutor_ExecuteFeedOnly_Reverts_Test is ExecuteFeedOnlyTestBase {

    function test_revertsOnEmptyPayload() public {
        _setUpFeedPool(true);

        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vm.expectRevert(KeeperExecutor.EmptyFeedPayload.selector);
        sys.executor.executeFeedOnly{value: 1 wei}(poolId, "");
    }

    function test_revertsWhenPriceFeedNotConfigured() public {
        _setUpFeedPool(false);

        bytes memory feedPayload = PythTestHelper.ethUsdtUpdate(uint64(block.timestamp));

        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(PoolConfigLib.PriceFeedNotConfigured.selector, poolId)
        );
        sys.executor.executeFeedOnly{value: 1 wei}(poolId, feedPayload);
    }

    function test_revertsOnStaleOraclePublishTime() public {
        _setUpFeedPool(true);

        PoolConfig memory cfg = PoolConfigBuilder.defaultEthUsdtPool();
        uint64 publishTime = uint64(block.timestamp - cfg.maxStalenessSec - 1);
        bytes memory feedPayload = PythTestHelper.ethUsdtUpdate(publishTime);

        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vm.expectRevert(PythErrors.StalePrice.selector);
        sys.executor.executeFeedOnly{value: 1 wei}(poolId, feedPayload);
    }

    function test_revertsOnInsufficientUpdateFee() public {
        _setUpFeedPool(true);

        bytes memory feedPayload = PythTestHelper.ethUsdtUpdate(uint64(block.timestamp));

        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(
                KeeperExecutor.InsufficientUpdateFee.selector, uint256(1), uint256(0)
            )
        );
        sys.executor.executeFeedOnly{value: 0}(poolId, feedPayload);
    }

}
