// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    DonateMode,
    KeeperExtension,
    KeeperTraits,
    PayoutMode
} from "src/types/KeeperExtensionTypes.sol";

library KeeperExtensionLib {

    uint8 internal constant EXT_VERSION = 1;

    uint8 internal constant ACTION_FEED_UPDATE = 1 << 0;
    uint8 internal constant ACTION_SYNC = 1 << 1;
    uint8 internal constant ALLOWED_ACTIONS_MASK = ACTION_FEED_UPDATE | ACTION_SYNC;

    uint16 internal constant BPS = 10_000;

    error InvalidVersion(uint8 versionReceived);
    error InvalidActions(uint8 actions);
    error EmptyFeedPayload();
    error MissingSyncTarget();
    error MissingKeeperExecution();
    error DonateParamOutOfRange();

    function decode(bytes calldata extension) internal pure returns (KeeperExtension memory ext) {
        ext = abi.decode(extension, (KeeperExtension));
        _validate(ext);
    }

    function hasFeedUpdate(KeeperExtension memory ext) internal pure returns (bool) {
        return (ext.actions & ACTION_FEED_UPDATE) != 0;
    }

    function hasSync(KeeperExtension memory ext) internal pure returns (bool) {
        return (ext.actions & ACTION_SYNC) != 0;
    }

    function resolveRecipient(KeeperTraits memory traits, address sender)
        internal
        pure
        returns (address)
    {
        return traits.recipient == address(0) ? sender : traits.recipient;
    }

    function donationBps(KeeperExtension memory ext) internal pure returns (uint16) {
        if (ext.traits.donateMode == DonateMode.SPECIFIED_BPS) return ext.traits.donateParam;
        return 0;
    }

    function _validate(KeeperExtension memory ext) private pure {
        if (ext.version != EXT_VERSION) revert InvalidVersion(ext.version);

        if ((ext.actions & ~ALLOWED_ACTIONS_MASK) != 0) revert InvalidActions(ext.actions);

        if (ext.actions == 0) revert InvalidActions(ext.actions);

        if (hasFeedUpdate(ext) && ext.feed.payload.length == 0) revert EmptyFeedPayload();
        if (hasSync(ext) && ext.sync.targetPriceX96 == 0) revert MissingSyncTarget();
        if (hasSync(ext) && ext.sync.keeperExecution.length < 20) revert MissingKeeperExecution();

        if (ext.traits.donateMode == DonateMode.SPECIFIED_BPS && ext.traits.donateParam > BPS) {
            revert DonateParamOutOfRange();
        }
    }

}
