// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Decodes packed keeper execution bytes:
/// [0:20]   executor address
/// [20:end] calldata passed to executor.call(...)
library KeeperExecutionLib {

    error ExecutionDataTooShort();

    function decode(bytes memory packed)
        internal
        pure
        returns (address executor, bytes memory executionCalldata)
    {
        if (packed.length < 20) revert ExecutionDataTooShort();

        assembly ("memory-safe") {
            executor := shr(96, mload(add(packed, 32)))
        }

        uint256 payloadLen = packed.length - 20;
        executionCalldata = new bytes(payloadLen);

        assembly ("memory-safe") {
            let dest := add(executionCalldata, 32)
            let src := add(add(packed, 32), 20)
            mcopy(dest, src, payloadLen)
        }
    }

}
