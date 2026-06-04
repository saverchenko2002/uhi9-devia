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

/// @notice Sync: нога 1 — v4 on-chain. Нога 2 — `externalSwap` (Kyber позже, опционально).
///
/// Пул 2000 / мир 2100 (ETH=token0, USDC=token1):
///   1) Keeper кладёт USDC (capital) на KeeperExecutor
///   2) Пул: USDC → ETH (к target)
///   3) [позже] External: ETH → USDC по рыночной цене
///   4) Профит в profitToken (USDC): donate в пул + payout keeper/treasury
///   5) Остаток capital (USDC) возвращается keeper
struct SyncData {
    uint256 targetPriceScaled;
    uint8 priceDecimals;
    /// @dev Пусто = только нога 1 (без settle профита). Иначе [0:20] executor + calldata внешней ноги.
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
