// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Settle + exact-in swap в unlock; hookData для min fee на keeper sync.
library UniswapV4Lib {

    using SafeERC20 for IERC20;
    using TransientStateLibrary for IPoolManager;

    bytes4 internal constant KEEPER_SYNC_SWAP = bytes4(keccak256("KEEPER_SYNC"));

    error NonPositiveOutputAmount();

    function settle(Currency currency, IPoolManager manager, address payer, uint256 amount)
        internal
    {
        if (amount == 0) return;

        if (currency.isAddressZero()) {
            manager.settle{value: amount}();
            return;
        }

        manager.sync(currency);
        if (payer != address(this)) {
            IERC20(Currency.unwrap(currency)).safeTransferFrom(payer, address(manager), amount);
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
        }
        manager.settle();
    }

    /// @dev Вызывать только из unlockCallback.
    function swapExactIn(
        IPoolManager manager,
        PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn,
        bytes memory hookData
    ) internal returns (uint256 amountOut) {
        uint160 sqrtPriceLimitX96 = zeroForOne
            ? TickMath.MIN_SQRT_PRICE + 1
            : TickMath.MAX_SQRT_PRICE - 1;

        (Currency inputCurrency, Currency outputCurrency) =
            zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);

        settle(inputCurrency, manager, address(this), amountIn);

        manager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            hookData
        );

        int256 credit = manager.currencyDelta(address(this), outputCurrency);
        if (credit <= 0) revert NonPositiveOutputAmount();
        amountOut = uint256(credit);

        manager.take(outputCurrency, address(this), amountOut);
    }

    function encodeKeeperSyncSwap() internal pure returns (bytes memory) {
        return abi.encodePacked(KEEPER_SYNC_SWAP);
    }

    function isKeeperSyncSwap(bytes calldata hookData) internal pure returns (bool) {
        return hookData.length >= 4 && bytes4(hookData[:4]) == KEEPER_SYNC_SWAP;
    }

}
