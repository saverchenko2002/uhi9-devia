// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library DynamicFeeConfig {

    uint16 internal constant BPS = 10_000;
    uint32 internal constant PPM = 1_000_000;
    uint16 internal constant BASE_FEE_BPS = 30;
    uint16 internal constant MIN_FEE_BPS = 5;
    uint16 internal constant MAX_FEE_BPS = 200;

    uint32 internal constant STALENESS_SLOPE_PPM_PER_SEC = 35_000;
    uint32 internal constant DEVIATION_SLOPE_PPM_PER_BPS = 7_000;

    uint32 internal constant MAX_STALENESS_SEC = 180;

}
