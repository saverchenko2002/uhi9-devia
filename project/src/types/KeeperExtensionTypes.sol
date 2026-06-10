// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

enum PayoutMode {
    WRAPPED,
    UNWRAPPED,
    TREASURY_DEPOSIT
}

enum DonateMode {
    MIN_ONLY,
    ALL,
    SPECIFIED_BPS
}

struct KeeperTraits {
    DonateMode donateMode;
    uint16 donateParam;
    PayoutMode payoutType;
    address recipient;
}

struct FeedUpdateData {
    bytes payload;
}

/// @notice Sync arb: leg 1 — v4 on-chain, leg 2 — `externalSwap` (required).
///
/// Pool 2000 / market 2100 (ETH=token0, USDC=token1):
///   1) Keeper deposits USDC (capital) on KeeperExecutor
///   2) Pool: USDC → ETH (toward target)
///   3) External: ETH → USDC at market price
///   4) Profit: donate to pool + payout keeper/treasury per profit token (profitToken + capital gain)
///   5) Remaining capital (USDC) returned to keeper
struct SyncData {
    uint256 targetPriceScaled;
    uint8 priceDecimals;
    /// @dev [0:20] executor address + calldata for the external arb leg (min 20 bytes).
    bytes externalSwap;
}

/// @dev Feed-only: `core/KeeperExecutor.executeFeedOnly`. Sync: `executeWithIntent` (ACTION_SYNC).
struct KeeperExtension {
    uint8 version;
    uint8 actions;
    KeeperTraits traits;
    FeedUpdateData feed;
    SyncData sync;
}
