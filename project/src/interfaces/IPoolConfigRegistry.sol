// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

interface IPoolConfigRegistry {

    event PoolRegistered(bytes32 indexed poolId, PoolConfig config);
    event PoolConfigUpdated(bytes32 indexed poolId, PoolConfig config);
    event HookRoleUpdated(address indexed hook, bool allowed);

    function registerPool(bytes32 poolId, PoolConfig calldata cfg) external;
    function updatePoolConfig(bytes32 poolId, PoolConfig calldata cfg) external;
    function getPoolConfig(bytes32 poolId) external view returns (PoolConfig memory);
    function isPoolRegistered(bytes32 poolId) external view returns (bool);

}
