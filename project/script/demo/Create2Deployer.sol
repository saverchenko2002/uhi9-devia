// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Generic CREATE2 deployer — initcode passed at call time (no embedded contract bytecode).
contract Create2Deployer {
    error DeployFailed();

    function deploy(bytes32 salt, bytes memory initCode) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        if (deployed == address(0)) revert DeployFailed();
    }
}
