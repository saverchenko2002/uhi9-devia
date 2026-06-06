// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Snapshot structs used when comparing hooked vs plain Uniswap v4 pools.
library PoolComparisonTypes {

    struct LpSnapshot {
        uint256 weth;
        uint256 usdt;
        uint256 valueUsdt;
    }

    /// @dev Economic breakdown for one pool side at a given valuation price.
    struct SideReport {
        LpSnapshot initialLp;
        LpSnapshot finalLp;
        int256 lpPnlUsdt;
        uint256 swapFeesToLpUsdt;
        uint256 arbProfitUsdt;
        uint256 poolDonationUsdt;
        uint256 keeperPayoutUsdt;
        uint256 treasuryClaimableUsdt;
    }

}
