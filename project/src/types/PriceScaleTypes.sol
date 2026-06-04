// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Как кодируется цена token1 за 1 token0 целыми числами.
///
/// Человекочитаемо:  ratio = targetPriceScaled / 10^priceDecimals
/// Пример (priceDecimals = 8): 1 token0 = 3000.12 token1  →  targetPriceScaled = 3000_12000000
///
/// priceDecimals — точность **котировки** (не ERC20 decimals USDC).
/// token0Decimals / token1Decimals — decimals ERC20 (для sqrtPriceX96 ↔ priceScaled).
struct PriceScale {
    uint8 token0Decimals;
    uint8 token1Decimals;
    uint8 priceDecimals;
}
