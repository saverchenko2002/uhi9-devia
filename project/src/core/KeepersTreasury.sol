// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {BaseInit} from "src/base/BaseInit.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";

contract KeepersTreasury is IKeepersTreasury, BaseInit {

    using SafeERC20 for IERC20;

    mapping(address hook => bool) public isHook;
    mapping(address executor => bool) public isExecutor;

    mapping(address keeper => mapping(address token => uint256 amount)) public claimable;

    error NotAuthorizedHook(address caller);
    error NotAuthorizedExecutor(address caller);
    error InvalidShareSplit();
    error NothingToClaim();

    modifier onlyHook() {
        if (!isHook[msg.sender]) revert NotAuthorizedHook(msg.sender);
        _;
    }

    modifier onlyExecutor() {
        if (!isExecutor[msg.sender]) revert NotAuthorizedExecutor(msg.sender);
        _;
    }

    constructor(address owner) BaseInit(owner) {}

    function setHook(address hook, bool allowed) external onlyOwner {
        isHook[hook] = allowed;
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        isExecutor[executor] = allowed;
    }

    /// @inheritdoc IKeepersTreasury
    function accrueSwapFee(
        bytes32 poolId,
        address token,
        uint256 totalFee,
        address feedKeeper,
        address syncKeeper,
        uint16 lpShareBps,
        uint16 syncShareBps,
        uint16 feedShareBps
    ) external onlyHook {
        poolId;
        if (totalFee == 0) return;

        if (
            uint256(lpShareBps) + uint256(syncShareBps) + uint256(feedShareBps) != PoolConfigLib.BPS
        ) {
            revert InvalidShareSplit();
        }

        uint256 syncAmount = (totalFee * syncShareBps) / PoolConfigLib.BPS;
        uint256 feedAmount = (totalFee * feedShareBps) / PoolConfigLib.BPS;
        uint256 lpAmount = totalFee - syncAmount - feedAmount;

        if (syncKeeper != address(0) && syncAmount > 0) {
            claimable[syncKeeper][token] += syncAmount;
        }
        if (feedKeeper != address(0) && feedAmount > 0) {
            claimable[feedKeeper][token] += feedAmount;
        }

        emit FeeAccrued(
            poolId, token, totalFee, lpAmount, syncAmount, feedAmount, syncKeeper, feedKeeper
        );
    }

    /// @inheritdoc IKeepersTreasury
    function depositForKeeper(address keeper, address token, uint256 amount) external onlyExecutor {
        if (amount == 0) return;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        claimable[keeper][token] += amount;
        emit KeeperDeposit(keeper, token, amount);
    }

    /// @inheritdoc IKeepersTreasury
    function claim(address token, address to) external returns (uint256 amount) {
        amount = claimable[msg.sender][token];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender][token] = 0;
        IERC20(token).safeTransfer(to, amount);
    }

}
