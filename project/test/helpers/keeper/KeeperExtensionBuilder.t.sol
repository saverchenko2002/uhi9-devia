// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    DonateMode,
    FeedUpdateData,
    KeeperExtension,
    KeeperTraits,
    PayoutMode,
    SyncData
} from "src/types/KeeperExtensionTypes.sol";

library KeeperExtensionBuilder {

    uint8 internal constant VERSION = 1;
    uint8 internal constant ACTION_FEED = 1 << 0;
    uint8 internal constant ACTION_SYNC = 1 << 1;

    function traits(
        DonateMode donateMode,
        uint16 donateParam,
        PayoutMode payoutType,
        address recipient
    ) internal pure returns (KeeperTraits memory) {
        return KeeperTraits({
            donateMode: donateMode,
            donateParam: donateParam,
            payoutType: payoutType,
            recipient: recipient
        });
    }

    function encodeFeedOnly(
        bytes memory feedPayload,
        DonateMode donateMode,
        uint16 donateParam,
        PayoutMode payoutType,
        address recipient
    ) internal pure returns (bytes memory) {
        return abi.encode(
            KeeperExtension({
                version: VERSION,
                actions: ACTION_FEED,
                traits: traits(donateMode, donateParam, payoutType, recipient),
                feed: FeedUpdateData({payload: feedPayload}),
                sync: SyncData({targetPriceScaled: 0, priceDecimals: 0, externalSwap: ""})
            })
        );
    }

    function encodeSyncWithExternal(
        uint256 targetPriceScaled,
        uint8 priceDecimals,
        bytes memory externalSwap,
        DonateMode donateMode,
        uint16 donateParam,
        PayoutMode payoutType,
        address recipient
    ) internal pure returns (bytes memory) {
        return abi.encode(
            KeeperExtension({
                version: VERSION,
                actions: ACTION_SYNC,
                traits: traits(donateMode, donateParam, payoutType, recipient),
                feed: FeedUpdateData({payload: ""}),
                sync: SyncData({
                    targetPriceScaled: targetPriceScaled,
                    priceDecimals: priceDecimals,
                    externalSwap: externalSwap
                })
            })
        );
    }

    function encodeFeedAndSyncWithExternal(
        bytes memory feedPayload,
        uint256 targetPriceScaled,
        uint8 priceDecimals,
        bytes memory externalSwap,
        DonateMode donateMode,
        uint16 donateParam,
        PayoutMode payoutType,
        address recipient
    ) internal pure returns (bytes memory) {
        return abi.encode(
            KeeperExtension({
                version: VERSION,
                actions: ACTION_FEED | ACTION_SYNC,
                traits: traits(donateMode, donateParam, payoutType, recipient),
                feed: FeedUpdateData({payload: feedPayload}),
                sync: SyncData({
                    targetPriceScaled: targetPriceScaled,
                    priceDecimals: priceDecimals,
                    externalSwap: externalSwap
                })
            })
        );
    }

}
