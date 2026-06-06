// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KeeperSyncLib} from "src/libs/KeeperSyncLib.sol";
import {DonateMode, KeeperExtension} from "src/types/KeeperExtensionTypes.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

/// @dev Exposes internal KeeperSyncLib functions for unit tests.
contract KeeperSyncLibWrapper {

    function decode(bytes calldata extension) external pure returns (KeeperExtension memory) {
        return KeeperSyncLib.decode(extension);
    }

    function computeDonationAmount(
        DonateMode mode,
        uint16 donateParam,
        uint256 arbProfit,
        uint256 minRequiredDonation
    ) external pure returns (uint256) {
        return KeeperSyncLib.computeDonationAmount(
            mode, donateParam, arbProfit, minRequiredDonation
        );
    }

    function decodeExternalSwap(bytes memory packed)
        external
        pure
        returns (address executor, bytes memory externalCalldata)
    {
        return KeeperSyncLib.decodeExternalSwap(packed);
    }

    function enforceMinImprovement(uint256 pre, uint256 post, PoolConfig memory cfg) external pure {
        KeeperSyncLib.enforceMinImprovement(pre, post, cfg);
    }

}
