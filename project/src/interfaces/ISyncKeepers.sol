// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISyncKeepers {

    event SyncRecorded(
        bytes32 indexed poolId,
        address indexed keeper,
        uint256 preDeviationBps,
        uint256 postDeviationBps,
        uint32 qualityBps,
        uint32 windowEndBlock
    );

    function recordSync(
        bytes32 poolId,
        address keeper,
        uint256 preDeviationBps,
        uint256 postDeviationBps
    ) external returns (uint32 qualityBps, uint32 windowEndBlock);

    function lastSyncBlock(bytes32 poolId) external view returns (uint256);

    /// @notice Active sync-keeper for fee share (within window).
    function getActiveSyncKeeper(bytes32 poolId)
        external
        view
        returns (address keeper, uint32 qualityBps, uint32 windowEndBlock, bool isActive);

    function setExecutor(address executor, bool allowed) external;

}
