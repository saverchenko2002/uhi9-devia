// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Per-pool configuration (v4 poolId => PoolConfig).
struct PoolConfig {
    // --- dynamic fee ---
    uint16 baseFeeBps;
    uint16 minFeeBps;
    uint16 maxFeeBps;
    uint32 stalenessSlopePpmPerSec;
    uint32 deviationSlopePpmPerBps;
    /// @dev Passed to IPyth.getPriceNoOlderThan(priceFeedId, maxStalenessSec).
    uint32 maxStalenessSec;

    // --- keeper / sync policy ---
    uint16 minDonateBps;
    uint16 maxDonateBps;
    uint16 minImprovementBps;
    uint16 minOverwriteImprovementBps;
    uint16 maxSlippageBps;

    // --- fee split (must sum to 10_000) ---
    uint16 lpShareBps;
    uint16 syncShareBps;
    uint16 feedShareBps;

    // --- oracle (Pyth) ---
    /// @dev bytes32(0) by default; owner must set via updatePoolConfig before feed updates.
    bytes32 priceFeedId;

    bool enabled;
}
