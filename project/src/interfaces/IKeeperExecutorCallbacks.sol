// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @dev Entry points on KeeperExecutor callable only from KeeperExecutorLogic / KeeperExecutorViewLogic.
interface IKeeperExecutorCallbacks {
    function executorPoolSwap(PoolKey calldata key, bool zeroForOne, uint256 amountIn)
        external
        returns (uint256 amountOut);

    function executorDonate(PoolKey calldata key, address token, uint256 amount) external;

    function executorPullCapital(address token, address from, uint256 amount) external;

    function executorApprove(address token, address spender, uint256 amount) external;

    function executorSafeTransfer(address token, address to, uint256 amount) external;

    function executorSafeTransferFull(address token, address to) external returns (uint256 amount);

    function executorTreasuryDeposit(address recipient, address token, uint256 amount) external;

    function executorExternalCall(address target, bytes calldata data) external returns (bool success);

    function executorRecordFeedUpdate(
        bytes32 poolId,
        address keeper,
        uint64 publishTime,
        uint32 qualityBps
    ) external;

    function executorRecordSync(bytes32 poolId, address keeper, uint256 preDev, uint256 postDev) external;
}
