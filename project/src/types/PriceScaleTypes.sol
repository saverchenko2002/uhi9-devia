// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice How token1-per-token0 price is encoded as an integer.
///
/// Human-readable: ratio = targetPriceScaled / 10^priceDecimals
/// Example (priceDecimals = 8): 1 token0 = 3000.12 token1 → targetPriceScaled = 3000_12000000
///
/// priceDecimals — quote precision (not ERC20 decimals of USDC).
/// token0Decimals / token1Decimals — ERC20 decimals (for sqrtPriceX96 ↔ priceScaled).
struct PriceScale {
    uint8 token0Decimals;
    uint8 token1Decimals;
    uint8 priceDecimals;
}
