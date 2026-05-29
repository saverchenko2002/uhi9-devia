// src/libs/DonationLib.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DonateMode} from "src/types/KeeperExtensionTypes.sol";

library DonationLib {

    uint16 internal constant BPS = 10_000;

    error InvalidSpecifiedBps(uint16 bps);
    error MinRequiredExceedsSurplus(uint256 minRequired, uint256 surplus);

    function computeDonationAmount(
        DonateMode mode,
        uint16 donateParam,
        uint256 surplus,
        uint256 minRequiredSurplus
    ) internal pure returns (uint256 donationAmount) {
        if (surplus == 0) return 0;

        if (minRequiredSurplus > surplus) {
            revert MinRequiredExceedsSurplus(minRequiredSurplus, surplus);
        }

        if (mode == DonateMode.MIN_ONLY) {
            return minRequiredSurplus;
        }

        if (mode == DonateMode.ALL) {
            return surplus;
        }

        if (donateParam > BPS) revert InvalidSpecifiedBps(donateParam);

        donationAmount = (surplus * donateParam) / BPS;

        if (donationAmount < minRequiredSurplus) {
            donationAmount = minRequiredSurplus;
        }

        if (donationAmount > surplus) {
            donationAmount = surplus;
        }
    }

}
