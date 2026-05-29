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

struct SyncData {
    uint256 targetPriceX96;
    bytes keeperExecution;
}

struct KeeperExtension {
    uint8 version;
    uint8 actions;
    KeeperTraits traits;
    FeedUpdateData feed;
    SyncData sync;
}
