// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Always reverts — for `ExecutionCallFailed` integration tests.
contract RevertingCallTarget {

    function alwaysRevert() external pure {
        revert();
    }

}
