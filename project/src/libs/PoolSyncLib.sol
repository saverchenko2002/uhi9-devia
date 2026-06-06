// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {KeeperSyncLib} from "src/libs/KeeperSyncLib.sol";
import {PoolFeeLib} from "src/libs/PoolFeeLib.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

/// @notice План свапа, чтобы цена пула (token1/token0) совпала с target или oracle.
library PoolSyncLib {

    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    error ZeroTargetPrice();
    error ZeroPoolLiquidity();
    error TargetSqrtOutOfBounds(uint160 sqrtPriceX96);

    /// @notice Какой exact-in свап сделать, чтобы дойти до targetPriceScaled.
    struct QuoteToTargetPlan {
        bool zeroForOne;
        uint256 amountIn;
        uint256 amountOut;
        uint160 poolSqrtPriceX96;
        int24 poolTick;
        uint160 targetSqrtPriceX96;
        int24 targetTick;
        uint256 targetPriceScaled;
    }

    function planQuoteSwapToOracle(
        bytes32 poolId,
        IPoolManager poolManager,
        IPyth oracle,
        PoolConfig memory cfg,
        PriceScale memory scale
    ) internal view returns (QuoteToTargetPlan memory plan) {
        PythStructs.Price memory p = PoolPriceLib.getConfiguredPrice(oracle, poolId, cfg);

        uint256 targetPriceScaled = PoolPriceLib.priceScaledFromPyth(p, scale.priceDecimals);
        return _planQuoteSwap(poolManager, poolId, targetPriceScaled, scale);
    }

    function planQuoteSwapToOracle(
        PoolKey calldata key,
        IPoolManager poolManager,
        IPyth oracle,
        PoolConfig memory cfg,
        uint8 priceDecimals
    ) internal view returns (QuoteToTargetPlan memory plan) {
        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, priceDecimals);
        return planQuoteSwapToOracle(PoolId.unwrap(key.toId()), poolManager, oracle, cfg, scale);
    }

    /// @param targetPriceScaled ratio = value / 10^scale.priceDecimals (token1 per token0).
    function planQuoteSwapToTarget(
        bytes32 poolId,
        IPoolManager poolManager,
        uint256 targetPriceScaled,
        PoolConfig memory cfg,
        PriceScale memory scale
    ) internal view returns (QuoteToTargetPlan memory plan) {
        cfg;
        if (targetPriceScaled == 0) revert ZeroTargetPrice();
        return _planQuoteSwap(poolManager, poolId, targetPriceScaled, scale);
    }

    function planQuoteSwapToTarget(
        PoolKey calldata key,
        IPoolManager poolManager,
        uint256 targetPriceScaled,
        PoolConfig memory cfg,
        uint8 priceDecimals
    ) internal view returns (QuoteToTargetPlan memory plan) {
        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, priceDecimals);
        return planQuoteSwapToTarget(
            PoolId.unwrap(key.toId()), poolManager, targetPriceScaled, cfg, scale
        );
    }

    function poolDeviationFromTargetBps(
        bytes32 poolId,
        IPoolManager poolManager,
        uint256 targetPriceScaled,
        PriceScale memory scale
    ) internal view returns (uint256 deviationBps) {
        if (targetPriceScaled == 0) revert ZeroTargetPrice();

        PoolId poolIdTyped = PoolId.wrap(poolId);
        (uint160 poolSqrtPriceX96,,,) = poolManager.getSlot0(poolIdTyped);
        uint256 poolPriceScaled = PoolPriceLib.priceScaledFromSqrtPriceX96(poolSqrtPriceX96, scale);
        return PoolFeeLib.deviationBps(poolPriceScaled, targetPriceScaled);
    }

    function poolDeviationFromTargetBps(
        PoolKey calldata key,
        IPoolManager poolManager,
        uint256 targetPriceScaled,
        uint8 priceDecimals
    ) internal view returns (uint256 deviationBps) {
        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, priceDecimals);
        return poolDeviationFromTargetBps(
            PoolId.unwrap(key.toId()), poolManager, targetPriceScaled, scale
        );
    }

    function _planQuoteSwap(
        IPoolManager poolManager,
        bytes32 poolId,
        uint256 targetPriceScaled,
        PriceScale memory scale
    ) private view returns (QuoteToTargetPlan memory plan) {
        PoolId poolIdTyped = PoolId.wrap(poolId);

        (uint160 poolSqrtPriceX96, int24 poolTick,,) = poolManager.getSlot0(poolIdTyped);
        uint128 liquidity = poolManager.getLiquidity(poolIdTyped);
        if (liquidity == 0) revert ZeroPoolLiquidity();

        uint160 targetSqrtPriceX96 =
            _clampSqrtPrice(PoolPriceLib.sqrtPriceX96FromPriceScaled(targetPriceScaled, scale));
        int24 targetTick = TickMath.getTickAtSqrtPrice(targetSqrtPriceX96);

        plan = QuoteToTargetPlan({
            zeroForOne: false,
            amountIn: 0,
            amountOut: 0,
            poolSqrtPriceX96: poolSqrtPriceX96,
            poolTick: poolTick,
            targetSqrtPriceX96: targetSqrtPriceX96,
            targetTick: targetTick,
            targetPriceScaled: targetPriceScaled
        });

        if (poolSqrtPriceX96 == targetSqrtPriceX96) {
            return plan;
        }

        if (poolSqrtPriceX96 > targetSqrtPriceX96) {
            plan.zeroForOne = true;
            plan.amountIn = SqrtPriceMath.getAmount0Delta(
                targetSqrtPriceX96, poolSqrtPriceX96, liquidity, true
            );
            plan.amountOut = SqrtPriceMath.getAmount1Delta(
                targetSqrtPriceX96, poolSqrtPriceX96, liquidity, false
            );
        } else {
            plan.zeroForOne = false;
            plan.amountIn = SqrtPriceMath.getAmount1Delta(
                poolSqrtPriceX96, targetSqrtPriceX96, liquidity, true
            );
            plan.amountOut = SqrtPriceMath.getAmount0Delta(
                poolSqrtPriceX96, targetSqrtPriceX96, liquidity, false
            );
        }
    }

    function _clampSqrtPrice(uint160 sqrtPriceX96) private pure returns (uint160) {
        if (sqrtPriceX96 <= TickMath.MIN_SQRT_PRICE) {
            revert TargetSqrtOutOfBounds(sqrtPriceX96);
        }
        if (sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) {
            revert TargetSqrtOutOfBounds(sqrtPriceX96);
        }
        return sqrtPriceX96;
    }

}
