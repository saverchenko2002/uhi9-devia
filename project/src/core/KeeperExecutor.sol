// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {BaseInit} from "src/base/BaseInit.sol";
import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeeperExecutorCallbacks} from "src/interfaces/IKeeperExecutorCallbacks.sol";
import {IKeeperExecutorLogic} from "src/interfaces/IKeeperExecutorLogic.sol";
import {IKeeperExecutorViewLogic} from "src/interfaces/IKeeperExecutorViewLogic.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";

import {KeeperExecutorErrors} from "src/errors/KeeperExecutorErrors.sol";
import {UniswapV4Lib} from "src/libs/UniswapV4Lib.sol";

/// @title KeeperExecutor
/// @notice Sync: on-chain pool → [optional external] → donate margin → payout → return capital.
contract KeeperExecutor is IKeeperExecutor, IKeeperExecutorCallbacks, BaseInit, IUnlockCallback {

    using SafeERC20 for IERC20;

    bytes1 private constant UNLOCK_POOL_SWAP = 0x01;
    bytes1 private constant UNLOCK_DONATE = 0x02;

    IPoolConfigRegistry public immutable poolConfigRegistry;
    IFeedKeepers public immutable feedKeepers;
    ISyncKeepers public immutable syncKeepers;
    IPyth public immutable oracle;
    IPoolManager public immutable poolManager;
    IKeepersTreasury public immutable keepersTreasury;
    address public immutable syncLogic;
    address public immutable viewLogic;

    struct PoolSwapUnlockData {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    struct DonateUnlockData {
        PoolKey key;
        uint256 amount0;
        uint256 amount1;
    }

    constructor(
        address owner,
        IPoolConfigRegistry _poolConfigRegistry,
        IFeedKeepers _feedKeepers,
        ISyncKeepers _syncKeepers,
        IPyth _oracle,
        IPoolManager _poolManager,
        IKeepersTreasury _keepersTreasury,
        address _syncLogic,
        address _viewLogic
    ) BaseInit(owner) {
        poolConfigRegistry = _poolConfigRegistry;
        feedKeepers = _feedKeepers;
        syncKeepers = _syncKeepers;
        oracle = _oracle;
        poolManager = _poolManager;
        keepersTreasury = _keepersTreasury;
        syncLogic = _syncLogic;
        viewLogic = _viewLogic;
    }

    /// @inheritdoc IKeeperExecutor
    function previewSync(bytes32 poolId, uint256 targetPriceScaled, uint8 priceDecimals)
        external
        view
        returns (SyncPreview memory preview)
    {
        return IKeeperExecutorViewLogic(viewLogic).previewSync(_env(), poolId, targetPriceScaled, priceDecimals);
    }

    /// @inheritdoc IKeeperExecutor
    function executeFeedOnly(bytes32 poolId, bytes calldata feedPayload)
        external
        payable
        returns (uint64 publishTime, uint32 qualityBps)
    {
        return IKeeperExecutorViewLogic(viewLogic).executeFeedOnly{value: msg.value}(
            _env(), msg.sender, poolId, feedPayload
        );
    }

    /// @inheritdoc IKeeperExecutor
    function executeWithIntent(KeeperIntent calldata intent)
        external
        payable
        returns (
            uint256 actualProfit,
            uint256 donationAmount,
            uint256 keeperPayout,
            uint256 capitalReturned
        )
    {
        return IKeeperExecutorLogic(syncLogic).executeWithIntent{value: msg.value}(_env(), msg.sender, intent);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert KeeperExecutorErrors.UnauthorizedUnlockCallback();

        (bytes1 action, bytes memory payload) = abi.decode(data, (bytes1, bytes));

        if (action == UNLOCK_POOL_SWAP) {
            PoolSwapUnlockData memory swapData = abi.decode(payload, (PoolSwapUnlockData));
            uint256 amountOut = UniswapV4Lib.swapExactIn(
                poolManager,
                swapData.key,
                swapData.zeroForOne,
                swapData.amountIn,
                UniswapV4Lib.encodeKeeperSyncSwap()
            );
            return abi.encode(amountOut);
        }

        if (action == UNLOCK_DONATE) {
            DonateUnlockData memory donateData = abi.decode(payload, (DonateUnlockData));
            poolManager.donate(donateData.key, donateData.amount0, donateData.amount1, "");
            if (donateData.amount0 > 0) {
                UniswapV4Lib.settle(
                    donateData.key.currency0, poolManager, address(this), donateData.amount0
                );
            }
            if (donateData.amount1 > 0) {
                UniswapV4Lib.settle(
                    donateData.key.currency1, poolManager, address(this), donateData.amount1
                );
            }
            return "";
        }

        revert KeeperExecutorErrors.UnknownUnlockAction(action);
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorPoolSwap(PoolKey calldata key, bool zeroForOne, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        _onlySyncLogic();
        bytes memory result = poolManager.unlock(
            abi.encode(
                UNLOCK_POOL_SWAP,
                abi.encode(PoolSwapUnlockData({key: key, zeroForOne: zeroForOne, amountIn: amountIn}))
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorDonate(PoolKey calldata key, address token, uint256 amount) external {
        _onlySyncLogic();
        (uint256 amount0, uint256 amount1) = _donationAmounts(key, token, amount);

        IERC20(token).forceApprove(address(poolManager), amount);

        poolManager.unlock(
            abi.encode(
                UNLOCK_DONATE,
                abi.encode(DonateUnlockData({key: key, amount0: amount0, amount1: amount1}))
            )
        );
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorPullCapital(address token, address from, uint256 amount) external {
        _onlySyncLogic();
        IERC20(token).safeTransferFrom(from, address(this), amount);
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorApprove(address token, address spender, uint256 amount) external {
        _onlySyncLogic();
        IERC20(token).forceApprove(spender, amount);
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorSafeTransfer(address token, address to, uint256 amount) external {
        _onlySyncLogic();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorSafeTransferFull(address token, address to) external returns (uint256 amount) {
        _onlySyncLogic();
        amount = IERC20(token).balanceOf(address(this));
        if (amount > 0) {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorTreasuryDeposit(address recipient, address token, uint256 amount) external {
        _onlySyncLogic();
        IERC20(token).forceApprove(address(keepersTreasury), amount);
        keepersTreasury.depositForKeeper(recipient, token, amount);
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorExternalCall(address target, bytes calldata data) external returns (bool success) {
        _onlySyncLogic();
        (success,) = target.call(data);
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorRecordFeedUpdate(
        bytes32 poolId,
        address keeper,
        uint64 publishTime,
        uint32 qualityBps
    ) external {
        _onlyViewLogic();
        feedKeepers.recordFeedUpdate(poolId, keeper, publishTime, qualityBps);
    }

    /// @inheritdoc IKeeperExecutorCallbacks
    function executorRecordSync(bytes32 poolId, address keeper, uint256 preDev, uint256 postDev) external {
        _onlySyncLogic();
        syncKeepers.recordSync(poolId, keeper, preDev, postDev);
    }

    function _env() private view returns (IKeeperExecutorLogic.Env memory env) {
        env = IKeeperExecutorLogic.Env({
            executor: address(this),
            poolConfigRegistry: poolConfigRegistry,
            feedKeepers: feedKeepers,
            syncKeepers: syncKeepers,
            oracle: oracle,
            poolManager: poolManager,
            keepersTreasury: keepersTreasury
        });
    }

    function _onlySyncLogic() private view {
        if (msg.sender != syncLogic) revert KeeperExecutorErrors.UnauthorizedLogic();
    }

    function _onlyViewLogic() private view {
        if (msg.sender != viewLogic) revert KeeperExecutorErrors.UnauthorizedLogic();
    }

    function _donationAmounts(PoolKey memory key, address token, uint256 amount)
        private
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);

        if (token == currency0) return (amount, 0);
        if (token == currency1) return (0, amount);
        revert KeeperExecutorErrors.TokenNotInPool(token, currency0, currency1);
    }
}
