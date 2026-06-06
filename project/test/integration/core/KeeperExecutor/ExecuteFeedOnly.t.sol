// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PythTestHelper} from "test/helpers/pyth/PythTestHelper.t.sol";
import {
    ExecuteFeedOnlyTestBase
} from "test/integration/core/KeeperExecutor/base/ExecuteFeedOnlyTestBase.t.sol";

contract KeeperExecutor_ExecuteFeedOnly_Test is ExecuteFeedOnlyTestBase {

    function setUp() public override {
        super.setUp();
        _setUpFeedPool(true);
    }

    function test_executeFeedOnly_recordsKeeperAndPublishTime() public {
        uint64 publishTime = uint64(block.timestamp);
        bytes memory feedPayload = PythTestHelper.ethUsdtUpdate(publishTime);

        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        (uint64 gotPublishTime, uint32 qualityBps) =
            sys.executor.executeFeedOnly{value: 1 wei}(poolId, feedPayload);

        assertEq(gotPublishTime, publishTime);
        assertGt(qualityBps, 0);
        assertEq(sys.feedKeepers.getLastProvider(poolId), keeper);
        assertEq(sys.feedKeepers.getLastPublishTime(poolId), publishTime);
    }

}
