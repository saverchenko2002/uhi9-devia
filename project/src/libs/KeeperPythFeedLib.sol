// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Keeper fee attribution rules for feed provider eligibility.
library KeeperPythFeedLib {

    /// @notice Feed keeper is eligible for feed-fee share only when Pyth publish time
    /// matches the timestamp recorded by our protocol (FeedKeepers via KeeperExecutor).
    /// If oracle is fresher than FeedKeepers history, someone else updated Pyth externally.
    function isLegitFeedProvider(uint64 pythPublishTime, uint64 feedKeepersPublishTime)
        internal
        pure
        returns (bool)
    {
        if (feedKeepersPublishTime == 0) return false;
        return pythPublishTime == feedKeepersPublishTime;
    }

    function resolveFeedProvider(
        uint64 pythPublishTime,
        uint64 feedKeepersPublishTime,
        address recordedProvider
    ) internal pure returns (address feedProvider) {
        if (!isLegitFeedProvider(pythPublishTime, feedKeepersPublishTime)) {
            return address(0);
        }
        return recordedProvider;
    }

}
