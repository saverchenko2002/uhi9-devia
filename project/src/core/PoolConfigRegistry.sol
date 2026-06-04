// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BaseInit} from "src/base/BaseInit.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

/// @notice Stores per-pool config. Registration is hook-only (afterInitialize).
contract PoolConfigRegistry is IPoolConfigRegistry, BaseInit {

    using PoolIdLibrary for PoolKey;

    mapping(bytes32 poolId => PoolConfig) private _configs;
    mapping(bytes32 poolId => PoolKey) private _poolKeys;
    mapping(address hook => bool) public isHook;

    error PoolAlreadyRegistered(bytes32 poolId);
    error PoolNotRegistered(bytes32 poolId);
    error NotAuthorizedHook(address caller);
    error PoolIdKeyMismatch(bytes32 poolId, bytes32 keyId);

    constructor(address owner) BaseInit(owner) {}

    function setHook(address hook, bool allowed) external onlyOwner {
        isHook[hook] = allowed;
        emit HookRoleUpdated(hook, allowed);
    }

    /// @inheritdoc IPoolConfigRegistry
    function registerPool(bytes32 poolId, PoolKey calldata key, PoolConfig calldata cfg) external {
        if (!isHook[msg.sender]) revert NotAuthorizedHook(msg.sender);
        if (_configs[poolId].enabled) revert PoolAlreadyRegistered(poolId);

        bytes32 keyId = PoolId.unwrap(key.toId());
        if (keyId != poolId) revert PoolIdKeyMismatch(poolId, keyId);

        PoolConfig memory c = cfg;
        PoolConfigLib.validate(c);
        _configs[poolId] = c;
        _poolKeys[poolId] = key;

        emit PoolRegistered(poolId, c);
    }

    /// @inheritdoc IPoolConfigRegistry
    function updatePoolConfig(bytes32 poolId, PoolConfig calldata cfg) external onlyOwner {
        if (!_configs[poolId].enabled) revert PoolNotRegistered(poolId);

        PoolConfig memory c = cfg;
        PoolConfigLib.validate(c);
        _configs[poolId] = c;

        emit PoolConfigUpdated(poolId, c);
    }

    /// @inheritdoc IPoolConfigRegistry
    function getPoolConfig(bytes32 poolId) external view returns (PoolConfig memory) {
        if (!_configs[poolId].enabled) revert PoolNotRegistered(poolId);
        return _configs[poolId];
    }

    /// @inheritdoc IPoolConfigRegistry
    function getPoolKey(bytes32 poolId) external view returns (PoolKey memory key) {
        if (!_configs[poolId].enabled) revert PoolNotRegistered(poolId);
        return _poolKeys[poolId];
    }

    /// @inheritdoc IPoolConfigRegistry
    function isPoolRegistered(bytes32 poolId) external view returns (bool) {
        return _configs[poolId].enabled;
    }

}
