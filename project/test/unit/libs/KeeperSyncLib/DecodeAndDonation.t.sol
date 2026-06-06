// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {DonateMode, KeeperExtension, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {KeeperExtensionBuilder} from "test/helpers/keeper/KeeperExtensionBuilder.t.sol";
import {KeeperSyncLibWrapper} from "test/helpers/wrappers/KeeperSyncLibWrapper.t.sol";

contract DecodeAndDonation_Test is Test {

    KeeperSyncLibWrapper internal wrapper;

    function setUp() public {
        wrapper = new KeeperSyncLibWrapper();
    }

    function test_decodesSyncExtension() public view {
        bytes memory ext = KeeperExtensionBuilder.encodeSyncWithExternal(
            TestConstants.ETH_USDT_PRICE_SCALED,
            TestConstants.PRICE_DECIMALS,
            "",
            DonateMode.MIN_ONLY,
            0,
            PayoutMode.WRAPPED,
            address(0)
        );

        KeeperExtension memory decoded = wrapper.decode(ext);

        assertEq(decoded.sync.targetPriceScaled, TestConstants.ETH_USDT_PRICE_SCALED);
        assertEq(decoded.sync.priceDecimals, TestConstants.PRICE_DECIMALS);
    }

    function test_donationMinOnly() public view {
        uint256 donation =
            wrapper.computeDonationAmount(DonateMode.MIN_ONLY, 0, 100 ether, 10 ether);
        assertEq(donation, 10 ether);
    }

    function test_donationAll() public view {
        uint256 donation = wrapper.computeDonationAmount(DonateMode.ALL, 0, 100 ether, 10 ether);
        assertEq(donation, 100 ether);
    }

}
