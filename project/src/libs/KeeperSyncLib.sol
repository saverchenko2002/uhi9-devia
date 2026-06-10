// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {DonateMode, KeeperExtension, KeeperTraits} from "src/types/KeeperExtensionTypes.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

/// @notice Keeper extension decode/validate, sync policy, donation, external swap calldata.
library KeeperSyncLib {

    uint8 internal constant EXT_VERSION = 1;

    uint8 internal constant ACTION_FEED_UPDATE = 1 << 0;
    uint8 internal constant ACTION_SYNC = 1 << 1;
    uint8 internal constant ALLOWED_ACTIONS_MASK = ACTION_FEED_UPDATE | ACTION_SYNC;

    uint16 internal constant BPS = 10_000;

    error InvalidVersion(uint8 versionReceived);
    error InvalidActions(uint8 actions);
    error EmptyFeedPayload();
    error MissingSyncTarget();
    error DonateParamOutOfRange();
    error FeedUpdateRequired();
    error SyncNotAllowedInFeedOnly();
    error ExecutionDataTooShort();
    error InvalidDonateParam();
    error ImprovementTooSmall(uint256 got, uint256 minRequired);
    error OverwriteImprovementTooSmall(uint256 got, uint256 minRequired);
    error SyncSlippageTooHigh(uint256 gotBps, uint256 maxAllowedBps);
    error InvalidSpecifiedBps(uint16 bps);
    error MinRequiredExceedsSurplus(uint256 minRequired, uint256 surplus);
    error ExternalSettlementRequired();

    uint256 internal constant MIN_EXTERNAL_SWAP_LENGTH = 20;

    // --- extension ---

    function decode(bytes calldata extension) internal pure returns (KeeperExtension memory ext) {
        ext = abi.decode(extension, (KeeperExtension));
        _validate(ext);
    }

    function decodeFeedOnly(bytes calldata extension)
        internal
        pure
        returns (KeeperExtension memory ext)
    {
        ext = abi.decode(extension, (KeeperExtension));
        _validateFeedOnly(ext);
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

    // --- external leg [0:20] router + calldata ---

    function decodeExternalSwap(bytes memory packed)
        internal
        pure
        returns (address executor, bytes memory externalCalldata)
    {
        if (packed.length < MIN_EXTERNAL_SWAP_LENGTH) revert ExecutionDataTooShort();

        assembly ("memory-safe") {
            executor := shr(96, mload(add(packed, 32)))
        }

        uint256 payloadLen = packed.length - 20;
        externalCalldata = new bytes(payloadLen);

        assembly ("memory-safe") {
            let dest := add(externalCalldata, 32)
            let src := add(add(packed, 32), 20)
            mcopy(dest, src, payloadLen)
        }
    }

    // --- policy ---

    function validateDonatePolicy(KeeperExtension memory ext, PoolConfig memory cfg) internal pure {
        if (ext.traits.donateMode == DonateMode.SPECIFIED_BPS) {
            uint16 p = ext.traits.donateParam;
            if (p < cfg.minDonateBps || p > cfg.maxDonateBps) revert InvalidDonateParam();
        }
    }

    function enforceMinImprovement(
        uint256 preDeviationBps,
        uint256 postDeviationBps,
        PoolConfig memory cfg
    ) internal pure {
        if (preDeviationBps <= postDeviationBps) {
            revert ImprovementTooSmall(0, cfg.minImprovementBps);
        }

        uint256 improvement = preDeviationBps - postDeviationBps;
        if (improvement < cfg.minImprovementBps) {
            revert ImprovementTooSmall(improvement, cfg.minImprovementBps);
        }
    }

    function enforceMinOverwriteImprovement(
        uint256 oldQualityBps,
        uint256 newQualityBps,
        PoolConfig memory cfg
    ) internal pure {
        if (newQualityBps <= oldQualityBps) {
            revert OverwriteImprovementTooSmall(0, cfg.minOverwriteImprovementBps);
        }

        uint256 improvement = newQualityBps - oldQualityBps;
        if (improvement < cfg.minOverwriteImprovementBps) {
            revert OverwriteImprovementTooSmall(improvement, cfg.minOverwriteImprovementBps);
        }
    }

    function enforceSyncSlippage(
        uint256 expectedProfit,
        uint256 actualProfit,
        PoolConfig memory cfg
    ) internal pure {
        if (expectedProfit == 0) {
            revert SyncSlippageTooHigh(type(uint256).max, cfg.maxSlippageBps);
        }
        if (actualProfit >= expectedProfit) return;

        uint256 slippageBps = ((expectedProfit - actualProfit) * PoolConfigLib.BPS) / expectedProfit;
        if (slippageBps > cfg.maxSlippageBps) {
            revert SyncSlippageTooHigh(slippageBps, cfg.maxSlippageBps);
        }
    }

    // --- donation from arbProfit ---

    function computeDonationAmount(
        DonateMode mode,
        uint16 donateParam,
        uint256 arbProfit,
        uint256 minRequiredDonation
    ) internal pure returns (uint256 donationAmount) {
        if (arbProfit == 0) return 0;

        if (minRequiredDonation > arbProfit) {
            revert MinRequiredExceedsSurplus(minRequiredDonation, arbProfit);
        }

        if (mode == DonateMode.MIN_ONLY) {
            return minRequiredDonation;
        }

        if (mode == DonateMode.ALL) {
            return arbProfit;
        }

        if (donateParam > BPS) revert InvalidSpecifiedBps(donateParam);

        donationAmount = (arbProfit * donateParam) / BPS;

        if (donationAmount < minRequiredDonation) {
            donationAmount = minRequiredDonation;
        }

        if (donationAmount > arbProfit) {
            donationAmount = arbProfit;
        }
    }

    function _validate(KeeperExtension memory ext) private pure {
        if (ext.version != EXT_VERSION) revert InvalidVersion(ext.version);

        if ((ext.actions & ~ALLOWED_ACTIONS_MASK) != 0) revert InvalidActions(ext.actions);

        if (ext.actions == 0) revert InvalidActions(ext.actions);

        if (hasFeedUpdate(ext) && ext.feed.payload.length == 0) revert EmptyFeedPayload();
        if (hasSync(ext) && ext.sync.targetPriceScaled == 0) revert MissingSyncTarget();
        if (hasSync(ext) && ext.sync.externalSwap.length < MIN_EXTERNAL_SWAP_LENGTH) {
            revert ExternalSettlementRequired();
        }

        if (ext.traits.donateMode == DonateMode.SPECIFIED_BPS && ext.traits.donateParam > BPS) {
            revert DonateParamOutOfRange();
        }
    }

    function _validateFeedOnly(KeeperExtension memory ext) private pure {
        if (ext.version != EXT_VERSION) revert InvalidVersion(ext.version);

        if ((ext.actions & ~ALLOWED_ACTIONS_MASK) != 0) revert InvalidActions(ext.actions);

        if (!hasFeedUpdate(ext)) revert FeedUpdateRequired();
        if (hasSync(ext)) revert SyncNotAllowedInFeedOnly();
        if (ext.feed.payload.length == 0) revert EmptyFeedPayload();
    }

}
