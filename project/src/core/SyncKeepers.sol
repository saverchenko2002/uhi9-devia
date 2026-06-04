// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseInit} from "src/base/BaseInit.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";
import {KeeperSyncLib} from "src/libs/KeeperSyncLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

contract SyncKeepers is ISyncKeepers, BaseInit {

    uint32 internal constant WINDOW_BLOCKS = 5;

    IPoolConfigRegistry public immutable poolConfigRegistry;

    mapping(bytes32 poolId => uint256) public lastSyncBlock;

    struct ActiveSync {
        address keeper;
        uint256 preDeviationBps;
        uint256 postDeviationBps;
        uint32 qualityBps;
        uint32 windowEndBlock;
    }

    mapping(bytes32 poolId => ActiveSync) private _active;
    mapping(address executor => bool) public isExecutor;

    error SyncAlreadyInBlock(bytes32 poolId);
    error NotAuthorizedExecutor(address caller);

    modifier onlyExecutor() {
        if (!isExecutor[msg.sender]) revert NotAuthorizedExecutor(msg.sender);
        _;
    }

    constructor(address owner, IPoolConfigRegistry registry) BaseInit(owner) {
        poolConfigRegistry = registry;
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        isExecutor[executor] = allowed;
    }

    /// @inheritdoc ISyncKeepers
    function recordSync(
        bytes32 poolId,
        address keeper,
        uint256 preDeviationBps,
        uint256 postDeviationBps
    ) external onlyExecutor returns (uint32 qualityBps, uint32 windowEndBlock) {
        if (lastSyncBlock[poolId] == block.number) revert SyncAlreadyInBlock(poolId);
        lastSyncBlock[poolId] = block.number;

        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);
        KeeperSyncLib.enforceMinImprovement(preDeviationBps, postDeviationBps, cfg);

        uint256 improvement = preDeviationBps - postDeviationBps;
        qualityBps = _qualityFromImprovement(improvement);

        windowEndBlock = uint32(block.number + WINDOW_BLOCKS);

        _active[poolId] = ActiveSync({
            keeper: keeper,
            preDeviationBps: preDeviationBps,
            postDeviationBps: postDeviationBps,
            qualityBps: qualityBps,
            windowEndBlock: windowEndBlock
        });

        emit SyncRecorded(
            poolId, keeper, preDeviationBps, postDeviationBps, qualityBps, windowEndBlock
        );
    }

    /// @inheritdoc ISyncKeepers
    function getActiveSyncKeeper(bytes32 poolId)
        external
        view
        returns (address keeper, uint32 qualityBps, uint32 windowEndBlock, bool isActive)
    {
        ActiveSync memory s = _active[poolId];
        keeper = s.keeper;
        qualityBps = s.qualityBps;
        windowEndBlock = s.windowEndBlock;
        isActive = keeper != address(0) && block.number <= windowEndBlock;
    }

    function _qualityFromImprovement(uint256 improvementBps) private pure returns (uint32) {
        if (improvementBps >= 10_000) return 10_000;
        return uint32(improvementBps);
    }

}
