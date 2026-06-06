// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {KeeperSyncLib} from "src/libs/KeeperSyncLib.sol";
import {
    DonateMode,
    FeedUpdateData,
    KeeperExtension,
    KeeperTraits,
    PayoutMode,
    SyncData
} from "src/types/KeeperExtensionTypes.sol";
import {KeeperExtensionBuilder} from "test/helpers/keeper/KeeperExtensionBuilder.t.sol";
import {KeeperSyncLibWrapper} from "test/helpers/wrappers/KeeperSyncLibWrapper.t.sol";

contract KeeperSyncLib_InvalidExtension_Reverts_Test is Test {

    KeeperSyncLibWrapper internal wrapper;

    function setUp() public {
        wrapper = new KeeperSyncLibWrapper();
    }

    function test_revertsOnInvalidVersion() public {
        KeeperExtension memory ext = KeeperExtension({
            version: 99,
            actions: 2,
            traits: KeeperTraits({
                donateMode: DonateMode.MIN_ONLY,
                donateParam: 0,
                payoutType: PayoutMode.WRAPPED,
                recipient: address(0)
            }),
            feed: FeedUpdateData({payload: ""}),
            sync: SyncData({targetPriceScaled: 1, priceDecimals: 8, externalSwap: ""})
        });

        bytes memory encoded = abi.encode(ext);

        vm.expectRevert(abi.encodeWithSelector(KeeperSyncLib.InvalidVersion.selector, uint8(99)));
        wrapper.decode(encoded);
    }

    function test_revertsOnMissingSyncTarget() public {
        bytes memory ext = KeeperExtensionBuilder.encodeSyncWithExternal(
            0, 8, "", DonateMode.MIN_ONLY, 0, PayoutMode.WRAPPED, address(0)
        );

        vm.expectRevert(KeeperSyncLib.MissingSyncTarget.selector);
        wrapper.decode(ext);
    }

    function test_revertsOnMissingExternalSettlement() public {
        bytes memory ext = KeeperExtensionBuilder.encodeSyncWithExternal(
            1, 8, "", DonateMode.MIN_ONLY, 0, PayoutMode.WRAPPED, address(0)
        );

        vm.expectRevert(KeeperSyncLib.ExternalSettlementRequired.selector);
        wrapper.decode(ext);
    }

}
