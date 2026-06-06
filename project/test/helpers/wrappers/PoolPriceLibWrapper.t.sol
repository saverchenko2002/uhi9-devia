// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

/// @dev Exposes internal PoolPriceLib functions for unit tests.
contract PoolPriceLibWrapper {

    function priceScaledFromSqrt(uint160 sqrtPriceX96, PriceScale memory scale)
        external
        pure
        returns (uint256)
    {
        return PoolPriceLib.priceScaledFromSqrtPriceX96(sqrtPriceX96, scale);
    }

    function sqrtFromPriceScaled(uint256 priceScaled, PriceScale memory scale)
        external
        pure
        returns (uint160)
    {
        return PoolPriceLib.sqrtPriceX96FromPriceScaled(priceScaled, scale);
    }

    function priceScaledFromPyth(int64 price, int32 expo, uint8 priceDecimals)
        external
        pure
        returns (uint256)
    {
        return PoolPriceLib.priceScaledFromPyth(
            PythStructs.Price({price: price, conf: 0, expo: expo, publishTime: 0}), priceDecimals
        );
    }

}
