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

    /// @notice Вызывается hook после свапа: делит fee по cfg (LP — pool fee, sync/feed — claimable).
    /// @dev Hook переводит sync+feed доли через `transferFrom`. Если eligible keeper отсутствует,
    ///      его доля остаётся LP (через `beforeSwap` lp fee) и в event `feedAmount`/`syncAmount` = 0.
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

    /// @notice Зачисление payout sync-keeper (из KeeperExecutor, PayoutMode.TREASURY_DEPOSIT).
    function depositForKeeper(address keeper, address token, uint256 amount) external;

    function claim(address token, address to) external returns (uint256 amount);

    function claimable(address keeper, address token) external view returns (uint256);

    function setHook(address hook, bool allowed) external;
    function setExecutor(address executor, bool allowed) external;

}
