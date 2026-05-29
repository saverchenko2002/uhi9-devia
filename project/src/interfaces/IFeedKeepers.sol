// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFeedKeepers {

    event FeedRecorded(
        bytes32 indexed poolId, address indexed provider, uint64 publishTime, uint32 qualityBps
    );

    /// @notice Records keeper attribution + quality after oracle price was updated elsewhere.
    function recordFeedUpdate(bytes32 poolId, address keeper, uint64 publishTime, uint32 qualityBps)
        external;

    function getLastProvider(bytes32 poolId) external view returns (address);

    function getQualityBps(bytes32 poolId) external view returns (uint32);

    function getLastPublishTime(bytes32 poolId) external view returns (uint64);

}
