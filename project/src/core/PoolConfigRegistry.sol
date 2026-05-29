// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {BaseUpgradeable} from "src/base/BaseUpgradeable.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

/// @notice Stores per-pool config. Registration is hook-only (afterInitialize).
contract PoolConfigRegistry is IPoolConfigRegistry, BaseUpgradeable {

    mapping(bytes32 poolId => PoolConfig) private _configs;
    mapping(address hook => bool) public isHook;
    error PoolAlreadyRegistered(bytes32 poolId);
    error PoolNotRegistered(bytes32 poolId);
    error NotAuthorizedHook(address caller);

    function initialize(address owner) external initializer {
        __Base_init();
        _transferOwnership(owner);
    }

    function setHook(address hook, bool allowed) external onlyOwner {
        isHook[hook] = allowed;
        emit HookRoleUpdated(hook, allowed);
    }

    /// @inheritdoc IPoolConfigRegistry
    function registerPool(bytes32 poolId, PoolConfig calldata cfg) external {
        if (!isHook[msg.sender]) revert NotAuthorizedHook(msg.sender);
        if (_configs[poolId].enabled) revert PoolAlreadyRegistered(poolId);
        PoolConfig memory c = cfg;
        PoolConfigLib.validate(c);
        _configs[poolId] = c;
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
    function isPoolRegistered(bytes32 poolId) external view returns (bool) {
        return _configs[poolId].enabled;
    }

}
