// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IKeeperExecutor {

    event KeeperIntentExecuted(
        bytes32 indexed poolId,
        address indexed keeper,
        uint256 amountIn,
        uint256 expectedOut,
        uint256 actualOut,
        uint256 donationAmount,
        uint256 keeperReturn
    );

    struct KeeperIntent {
        bytes32 poolId;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 expectedOut;
        bytes extension;
    }

    /// @notice Main keeper entrypoint.
    ///  amountIn X tokens pulled from keeper (tokenIn).
    ///  expectedOut U baseline from quote; slippage checked against pool config.
    function executeWithIntent(KeeperIntent calldata intent)
        external
        payable
        returns (uint256 actualOut, uint256 donationAmount, uint256 keeperReturn);

}
