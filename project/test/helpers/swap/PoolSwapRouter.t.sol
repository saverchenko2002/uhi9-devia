// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {UniswapV4Lib} from "src/libs/UniswapV4Lib.sol";

/// @dev Test helper: unlock → settle(payer) → swap → take(payer).
contract PoolSwapRouter is IUnlockCallback {

    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;

    error UnauthorizedCallback();
    error NonPositiveOutputAmount();

    struct CallbackData {
        address payer;
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        bytes hookData;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function swapExactIn(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        bytes calldata hookData,
        address payer
    ) external returns (uint256 amountOut) {
        amountOut = abi.decode(
            poolManager.unlock(
                abi.encode(
                    CallbackData({
                        payer: payer,
                        key: key,
                        zeroForOne: zeroForOne,
                        amountIn: amountIn,
                        hookData: hookData
                    })
                )
            ),
            (uint256)
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedCallback();

        CallbackData memory cb = abi.decode(data, (CallbackData));

        uint160 sqrtPriceLimitX96 = cb.zeroForOne
            ? TickMath.MIN_SQRT_PRICE + 1
            : TickMath.MAX_SQRT_PRICE - 1;

        (Currency inputCurrency, Currency outputCurrency) = cb.zeroForOne
            ? (cb.key.currency0, cb.key.currency1)
            : (cb.key.currency1, cb.key.currency0);

        UniswapV4Lib.settle(inputCurrency, poolManager, cb.payer, cb.amountIn);

        poolManager.swap(
            cb.key,
            SwapParams({
                zeroForOne: cb.zeroForOne,
                amountSpecified: -int256(cb.amountIn),
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            cb.hookData
        );

        int256 credit = poolManager.currencyDelta(address(this), outputCurrency);
        if (credit <= 0) revert NonPositiveOutputAmount();

        uint256 amountOut = uint256(credit);
        poolManager.take(outputCurrency, cb.payer, amountOut);

        return abi.encode(amountOut);
    }

}
