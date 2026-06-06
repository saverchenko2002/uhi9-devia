// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {PythUtils} from "@pythnetwork/pyth-sdk-solidity/PythUtils.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

/// @notice Цена пула: sqrtPriceX96 ↔ priceScaled, decimals пары, Pyth.
library PoolPriceLib {

    // --- sqrtPriceX96 ↔ priceScaled (token1 per token0, см. PriceScale) ---

    function priceScaledFromSqrtPriceX96(uint160 sqrtPriceX96, PriceScale memory scale)
        internal
        pure
        returns (uint256 priceScaled)
    {
        uint256 unitAmount0 = 10 ** (scale.priceDecimals + scale.token0Decimals);
        uint256 amount1AtSqrt = FullMath.mulDiv(
            uint256(sqrtPriceX96) * uint256(sqrtPriceX96),
            unitAmount0,
            uint256(FixedPoint96.Q96) * uint256(FixedPoint96.Q96)
        );
        return FullMath.mulDiv(amount1AtSqrt, 1, 10 ** scale.token1Decimals);
    }

    function sqrtPriceX96FromPriceScaled(uint256 priceScaled, PriceScale memory scale)
        internal
        pure
        returns (uint160 sqrtPriceX96)
    {
        if (priceScaled == 0) return 0;

        uint256 amount1 = priceScaled * (10 ** scale.token1Decimals);
        uint256 amount0 = 10 ** (scale.priceDecimals + scale.token0Decimals);
        return encodeSqrtRatioX96(amount1, amount0);
    }

    function encodeSqrtRatioX96(uint256 amount1, uint256 amount0)
        internal
        pure
        returns (uint160 sqrtPriceX96)
    {
        return uint160(Math.sqrt(FullMath.mulDiv(amount1, 1 << 192, amount0)));
    }

    // --- PriceScale из PoolKey ---

    function priceScaleFromPoolKey(PoolKey memory key, uint8 priceDecimals)
        internal
        view
        returns (PriceScale memory scale)
    {
        scale.token0Decimals = currencyDecimals(key.currency0);
        scale.token1Decimals = currencyDecimals(key.currency1);
        scale.priceDecimals = priceDecimals;
    }

    function currencyDecimals(Currency currency) internal view returns (uint8) {
        address token = Currency.unwrap(currency);
        if (token == address(0)) {
            return 18;
        }
        return IERC20Metadata(token).decimals();
    }

    // --- Pyth ---

    function getConfiguredPrice(IPyth oracle, bytes32 poolId, PoolConfig memory cfg)
        internal
        view
        returns (PythStructs.Price memory price)
    {
        PoolConfigLib.requirePriceFeedId(poolId, cfg);
        return oracle.getPriceNoOlderThan(cfg.priceFeedId, cfg.maxStalenessSec);
    }

    function priceScaledFromPyth(PythStructs.Price memory pythPrice, uint8 priceDecimals)
        internal
        pure
        returns (uint256 priceScaled)
    {
        return PythUtils.convertToUint(pythPrice.price, pythPrice.expo, priceDecimals);
    }

    function pythPriceDecimals(PythStructs.Price memory pythPrice) internal pure returns (uint8) {
        int32 expo = pythPrice.expo;
        if (expo >= 0) return uint8(uint32(expo));
        return uint8(uint32(-expo));
    }

}
