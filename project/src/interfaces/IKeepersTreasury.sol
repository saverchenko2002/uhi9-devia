// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IKeepersTreasury {

    event FeeAccrued(
        bytes32 indexed poolId,
        address token,
        uint256 totalFee,
        uint256 lpAmount,
        uint256 syncAmount,
        uint256 feedAmount,
        address indexed syncKeeper,
        address indexed feedKeeper
    );

    event KeeperDeposit(address indexed keeper, address indexed token, uint256 amount);

    /// @notice Called by hook after swap: splits fee per cfg (LP — pool fee, sync/feed — claimable).
    /// @dev Hook transfers sync+feed shares via `transferFrom`. If no eligible keeper exists,
    ///      its share stays with LP (via `beforeSwap` lp fee) and event `feedAmount`/`syncAmount` = 0.
    function accrueSwapFee(
        bytes32 poolId,
        address token,
        uint256 totalFee,
        address feedKeeper,
        address syncKeeper,
        uint16 lpShareBps,
        uint16 syncShareBps,
        uint16 feedShareBps
    ) external;

    /// @notice Credit sync-keeper payout (from KeeperExecutor, PayoutMode.TREASURY_DEPOSIT).
    function depositForKeeper(address keeper, address token, uint256 amount) external;

    function claim(address token, address to) external returns (uint256 amount);

    function claimable(address keeper, address token) external view returns (uint256);

    function setHook(address hook, bool allowed) external;
    function setExecutor(address executor, bool allowed) external;

}
