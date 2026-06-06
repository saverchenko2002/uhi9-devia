// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";

library PoolConfigBuilder {

    function defaultWithFeed(bytes32 priceFeedId) internal pure returns (PoolConfig memory cfg) {
        cfg = PoolConfigLib.defaultConfig();
        cfg.priceFeedId = priceFeedId;
    }

    function defaultEthUsdtPool() internal pure returns (PoolConfig memory cfg) {
        return defaultWithFeed(TestConstants.ETH_USD_FEED_ID);
    }

}
