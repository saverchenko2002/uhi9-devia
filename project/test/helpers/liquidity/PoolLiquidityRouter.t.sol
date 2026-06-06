// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {UniswapV4Lib} from "src/libs/UniswapV4Lib.sol";

import {console2} from "forge-std/src/console2.sol";

/// @dev Test helper: unlock → modifyLiquidity → settle.
contract PoolLiquidityRouter is IUnlockCallback {

    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable poolManager;

    error UnauthorizedCallback();

    struct CallbackData {
        address payer;
        PoolKey key;
        ModifyLiquidityParams params;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    /// @dev Token-first: pass WETH/USDT budgets; `L` is computed inside (like PositionManager).
    function addLiquidityFromAmounts(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        uint256 amount0,
        uint256 amount1,
        address payer
    ) external payable returns (BalanceDelta delta) {
        console2.log("hello1");

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0,
            amount1
        );

        return addLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: 0
            }),
            payer
        );
    }

    function addLiquidity(PoolKey calldata key, ModifyLiquidityParams memory params, address payer)
        public
        payable
        returns (BalanceDelta delta)
    {
        delta = abi.decode(
            poolManager.unlock(abi.encode(CallbackData({payer: payer, key: key, params: params}))),
            (BalanceDelta)
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedCallback();

        CallbackData memory cb = abi.decode(data, (CallbackData));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(cb.key, cb.params, "");

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        if (delta0 < 0) {
            UniswapV4Lib.settle(cb.key.currency0, poolManager, cb.payer, uint256(int256(-delta0)));
        }
        if (delta1 < 0) {
            UniswapV4Lib.settle(cb.key.currency1, poolManager, cb.payer, uint256(int256(-delta1)));
        }
        if (delta0 > 0) {
            poolManager.take(cb.key.currency0, cb.payer, uint256(int256(delta0)));
        }
        if (delta1 > 0) {
            poolManager.take(cb.key.currency1, cb.payer, uint256(int256(delta1)));
        }

        return abi.encode(delta);
    }

}
