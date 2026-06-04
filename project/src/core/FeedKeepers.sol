// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseInit} from "src/base/BaseInit.sol";
import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";

/// @notice Local feed metadata only. Price is always read from oracle.getPrice.
contract FeedKeepers is IFeedKeepers, BaseInit {

    struct FeedMeta {
        address lastProvider;
        uint32 qualityBps;
        uint64 lastPublishTime;
    }

    mapping(bytes32 poolId => FeedMeta) private _feeds;
    mapping(address executor => bool) public isExecutor;

    error NotAuthorizedExecutor(address caller);
    error StaleFeedUpdate(uint64 got, uint64 existing);

    modifier onlyExecutor() {
        if (!isExecutor[msg.sender]) revert NotAuthorizedExecutor(msg.sender);
        _;
    }

    constructor(address owner) BaseInit(owner) {}

    function setExecutor(address executor, bool allowed) external onlyOwner {
        isExecutor[executor] = allowed;
    }

    /// @inheritdoc IFeedKeepers
    function recordFeedUpdate(bytes32 poolId, address keeper, uint64 publishTime, uint32 qualityBps)
        external
        onlyExecutor
    {
        FeedMeta storage feed = _feeds[poolId];

        if (feed.lastPublishTime != 0 && publishTime <= feed.lastPublishTime) {
            revert StaleFeedUpdate(publishTime, feed.lastPublishTime);
        }

        feed.lastProvider = keeper;
        feed.qualityBps = qualityBps;
        feed.lastPublishTime = publishTime;

        emit FeedRecorded(poolId, keeper, publishTime, qualityBps);
    }

    /// @inheritdoc IFeedKeepers
    function getLastProvider(bytes32 poolId) external view returns (address) {
        return _feeds[poolId].lastProvider;
    }

    /// @inheritdoc IFeedKeepers
    function getQualityBps(bytes32 poolId) external view returns (uint32) {
        return _feeds[poolId].qualityBps;
    }

    /// @inheritdoc IFeedKeepers
    function getLastPublishTime(bytes32 poolId) external view returns (uint64) {
        return _feeds[poolId].lastPublishTime;
    }

}
