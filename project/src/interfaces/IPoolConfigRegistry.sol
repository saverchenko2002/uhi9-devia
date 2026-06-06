// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

interface IPoolConfigRegistry {

    event PoolRegistered(bytes32 indexed poolId, PoolConfig config);
    event PoolConfigUpdated(bytes32 indexed poolId, PoolConfig config);
    event HookRoleUpdated(address indexed hook, bool allowed);

    function setHook(address hook, bool allowed) external;
    function registerPool(bytes32 poolId, PoolKey calldata key, PoolConfig calldata cfg) external;
    function updatePoolConfig(bytes32 poolId, PoolConfig calldata cfg) external;
    function getPoolConfig(bytes32 poolId) external view returns (PoolConfig memory);
    function getPoolKey(bytes32 poolId) external view returns (PoolKey memory key);
    function isPoolRegistered(bytes32 poolId) external view returns (bool);

}
