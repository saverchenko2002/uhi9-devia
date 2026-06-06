// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/src/Vm.sol";

/// @dev Parses `KeepersTreasury.FeeAccrued` logs emitted during public swaps on hooked pools.
library FeeAccruedParser {

    bytes32 internal constant FEE_ACCRUED_TOPIC =
        keccak256("FeeAccrued(bytes32,address,uint256,uint256,uint256,uint256,address,address)");

    struct Totals {
        uint256 totalFee;
        uint256 lpShare;
        uint256 syncShare;
        uint256 feedShare;
    }

    function accumulate(Vm.Log[] memory logs, bytes32 poolId, Totals memory running)
        internal
        pure
        returns (Totals memory updated)
    {
        updated = running;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length < 2) continue;
            if (logs[i].topics[0] != FEE_ACCRUED_TOPIC) continue;
            if (logs[i].topics[1] != poolId) continue;

            (, uint256 totalFee, uint256 lpShare, uint256 syncShare, uint256 feedShare) =
                abi.decode(logs[i].data, (address, uint256, uint256, uint256, uint256));

            updated.totalFee += totalFee;
            updated.lpShare += lpShare;
            updated.syncShare += syncShare;
            updated.feedShare += feedShare;
        }
    }

}
