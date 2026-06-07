// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Shared custom errors for KeeperExecutor and KeeperExecutorLogic (stable selectors for tests).
library KeeperExecutorErrors {
    error ExecutionCallFailed();
    error InsufficientUpdateFee(uint256 required, uint256 provided);
    error SyncActionRequired();
    error UnauthorizedUnlockCallback();
    error UnauthorizedLogic();
    error UnknownUnlockAction(bytes1 action);
    error KeepersTreasuryNotConfigured();
    error TokenNotInPool(address token, address currency0, address currency1);
    error CapitalTokenMismatch(address expected, address got);
    error InsufficientCapital(uint256 need, uint256 got);
    error NonPositiveArbProfit(uint256 profit);
    error EmptyFeedPayload();
}
