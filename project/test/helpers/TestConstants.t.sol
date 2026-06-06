// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

library TestConstants {

    uint8 internal constant PRICE_DECIMALS = 8;
    uint8 internal constant TOKEN0_DECIMALS = 18;
    uint8 internal constant TOKEN1_DECIMALS = 6;

    uint16 internal constant BPS = 10_000;

    /// @dev 3000 USDT per 1 ETH at PRICE_DECIMALS.
    uint256 internal constant ETH_USDT_PRICE_SCALED = 3000e8;

    uint256 internal constant ETH_USDT_PRICE_SCALED_TARGET = 3100e8;

    /// @dev Pyth ETH/USD on Ethereum mainnet.
    bytes32 internal constant ETH_USD_FEED_ID =
        0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    uint256 internal constant PYTH_VALID_TIME_PERIOD = 3600;
    uint256 internal constant PYTH_UPDATE_FEE = 1 wei;

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    int24 internal constant POOL_TICK_SPACING = 60;

    //todo: when everything is ready hardcode
    bytes32 internal constant DYNAMIC_FEE_HOOK_SALT = bytes32(0);

    uint256 internal constant TEST_BLOCK_FIXED = 25257218;

    /// @dev WETH budget for LP seeding in sync integration tests.
    uint256 internal constant SYNC_TEST_LP_WETH = 100 ether;

    function syncTestFullRangeTickLower() internal pure returns (int24) {
        return (TickMath.MIN_TICK / POOL_TICK_SPACING) * POOL_TICK_SPACING;
    }

    function syncTestFullRangeTickUpper() internal pure returns (int24) {
        return (TickMath.MAX_TICK / POOL_TICK_SPACING) * POOL_TICK_SPACING;
    }

    function syncTestLpUsdtAmount() internal pure returns (uint256) {
        return usdtForWethAtPrice(SYNC_TEST_LP_WETH, ETH_USDT_PRICE_SCALED);
    }

    /// @dev token1 amount for `token0Amount` at `priceScaled` (token1 per token0, PRICE_DECIMALS).
    function usdtForWethAtPrice(uint256 wethAmount, uint256 priceScaled)
        internal
        pure
        returns (uint256)
    {
        return wethAmount * priceScaled * (10 ** TOKEN1_DECIMALS)
            / (10 ** (PRICE_DECIMALS + TOKEN0_DECIMALS));
    }

}
