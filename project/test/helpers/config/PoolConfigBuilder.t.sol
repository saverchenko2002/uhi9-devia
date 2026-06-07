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

    /// @dev Demo-friendly fee band in v4 pips (~1% / 0.5% / 3%, +66 suffix avoids mainnet poolId collisions).
    uint24 internal constant DEMO_BASE_FEE_PIPS = 10_066;
    uint16 internal constant DEMO_BASE_FEE = 10_066;
    uint16 internal constant DEMO_MIN_FEE = 5_033;
    uint16 internal constant DEMO_MAX_FEE = 30_198;
    /// @dev Scaled ~152× vs default so staleness/deviation are visible at demo base fee.
    uint32 internal constant DEMO_STALENESS_SLOPE_PPM_PER_SEC = 5_320_000;
    uint32 internal constant DEMO_DEVIATION_SLOPE_PPM_PER_BPS = 1_064_000;
    uint32 internal constant DEMO_MAX_STALENESS_SEC = 7_200;

    function demoEthUsdtPool() internal pure returns (PoolConfig memory cfg) {
        cfg = defaultEthUsdtPool();
        cfg.baseFeeBps = DEMO_BASE_FEE;
        cfg.minFeeBps = DEMO_MIN_FEE;
        cfg.maxFeeBps = DEMO_MAX_FEE;
        cfg.stalenessSlopePpmPerSec = DEMO_STALENESS_SLOPE_PPM_PER_SEC;
        cfg.deviationSlopePpmPerBps = DEMO_DEVIATION_SLOPE_PPM_PER_BPS;
        cfg.maxStalenessSec = DEMO_MAX_STALENESS_SEC;
    }

    function demoBaseFeePips() internal pure returns (uint24) {
        return DEMO_BASE_FEE_PIPS;
    }

}
