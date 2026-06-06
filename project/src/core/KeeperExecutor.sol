// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {BaseInit} from "src/base/BaseInit.sol";
import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {KeeperExtension, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

import {KeeperSyncLib} from "src/libs/KeeperSyncLib.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PoolSyncLib} from "src/libs/PoolSyncLib.sol";
import {UniswapV4Lib} from "src/libs/UniswapV4Lib.sol";

/// @title KeeperExecutor
/// @notice Sync: пул on-chain → [опционально external] → donate маржи → payout → возврат capital.
contract KeeperExecutor is IKeeperExecutor, BaseInit, IUnlockCallback {

    using SafeERC20 for IERC20;
    using KeeperSyncLib for bytes;
    using KeeperSyncLib for KeeperExtension;
    using PoolIdLibrary for PoolKey;

    bytes1 private constant UNLOCK_POOL_SWAP = 0x01;
    bytes1 private constant UNLOCK_DONATE = 0x02;

    IPoolConfigRegistry public immutable poolConfigRegistry;
    IFeedKeepers public immutable feedKeepers;
    ISyncKeepers public immutable syncKeepers;
    IPyth public immutable oracle;
    IPoolManager public immutable poolManager;
    IKeepersTreasury public immutable keepersTreasury;

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

    error ExecutionCallFailed();
    error InsufficientUpdateFee(uint256 required, uint256 provided);
    error SyncActionRequired();
    error UnauthorizedUnlockCallback();
    error UnknownUnlockAction(bytes1 action);
    error KeepersTreasuryNotConfigured();
    error TokenNotInPool(address token, address currency0, address currency1);
    error CapitalTokenMismatch(address expected, address got);
    error InsufficientCapital(uint256 need, uint256 got);
    error NonPositiveArbProfit(uint256 profit);
    error ExternalSettlementRequired();
    error EmptyFeedPayload();

    constructor(
        address owner,
        IPoolConfigRegistry _poolConfigRegistry,
        IFeedKeepers _feedKeepers,
        ISyncKeepers _syncKeepers,
        IPyth _oracle,
        IPoolManager _poolManager,
        IKeepersTreasury _keepersTreasury
    ) BaseInit(owner) {
        poolConfigRegistry = _poolConfigRegistry;
        feedKeepers = _feedKeepers;
        syncKeepers = _syncKeepers;
        oracle = _oracle;
        poolManager = _poolManager;
        keepersTreasury = _keepersTreasury;
    }

    /// @inheritdoc IKeeperExecutor
    function previewSync(bytes32 poolId, uint256 targetPriceScaled, uint8 priceDecimals)
        external
        view
        returns (SyncPreview memory preview)
    {
        PoolKey memory key = poolConfigRegistry.getPoolKey(poolId);
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);
        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, priceDecimals);

        PoolSyncLib.QuoteToTargetPlan memory plan =
            PoolSyncLib.planQuoteSwapToTarget(poolId, poolManager, targetPriceScaled, cfg, scale);

        _fillPreview(preview, key, plan, poolId, targetPriceScaled, scale, cfg);
    }

    /// @inheritdoc IKeeperExecutor
    function executeFeedOnly(bytes32 poolId, bytes calldata feedPayload)
        external
        payable
        returns (uint64 publishTime, uint32 qualityBps)
    {
        if (feedPayload.length == 0) revert EmptyFeedPayload();

        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);
        PoolConfigLib.requirePriceFeedId(poolId, cfg);

        (publishTime, qualityBps) = _submitFeedUpdate(poolId, feedPayload, cfg);

        emit FeedUpdateExecuted(poolId, msg.sender, publishTime, qualityBps);
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
        bytes32 poolId = intent.poolId;
        KeeperExtension memory ext = intent.extension.decode();
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);
        PoolKey memory key = poolConfigRegistry.getPoolKey(poolId);
        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, ext.sync.priceDecimals);

        KeeperSyncLib.validateDonatePolicy(ext, cfg);

        if (!ext.hasSync()) revert SyncActionRequired();

        uint256 targetPriceScaled = ext.sync.targetPriceScaled;
        PoolSyncLib.QuoteToTargetPlan memory plan =
            PoolSyncLib.planQuoteSwapToTarget(poolId, poolManager, targetPriceScaled, cfg, scale);

        SyncPreview memory expected = _previewFromPlan(key, plan, poolId, targetPriceScaled, scale);

        if (intent.capitalToken != expected.poolSwapTokenIn) {
            revert CapitalTokenMismatch(expected.poolSwapTokenIn, intent.capitalToken);
        }
        _validateProfitToken(key, intent.profitToken);

        if (intent.capitalAmount < plan.amountIn) {
            revert InsufficientCapital(plan.amountIn, intent.capitalAmount);
        }

        uint256 preDev = expected.poolDeviationBps;
        bool hasExternal = ext.sync.externalSwap.length >= 20;

        uint256 profitBaseline = IERC20(intent.profitToken).balanceOf(address(this));

        IERC20(intent.capitalToken)
            .safeTransferFrom(msg.sender, address(this), intent.capitalAmount);

        uint256 amountOut = _executePoolSwap(key, plan.zeroForOne, plan.amountIn);

        if (hasExternal) {
            (address executor, bytes memory externalCalldata) =
                KeeperSyncLib.decodeExternalSwap(ext.sync.externalSwap);

            IERC20(expected.poolSwapTokenOut).forceApprove(executor, amountOut);

            (bool ok,) = executor.call(externalCalldata);
            if (!ok) revert ExecutionCallFailed();

            if (intent.capitalToken == intent.profitToken) {
                uint256 profitAfter = IERC20(intent.profitToken).balanceOf(address(this));
                if (profitAfter <= profitBaseline + intent.capitalAmount) {
                    revert NonPositiveArbProfit(profitAfter - profitBaseline - intent.capitalAmount);
                }
                actualProfit = profitAfter - profitBaseline - intent.capitalAmount;
            } else {
                uint256 profitAfter = IERC20(intent.profitToken).balanceOf(address(this));
                if (profitAfter <= profitBaseline) {
                    revert NonPositiveArbProfit(profitAfter - profitBaseline);
                }
                actualProfit = profitAfter - profitBaseline;
            }

            KeeperSyncLib.enforceSyncSlippage(intent.expectedProfit, actualProfit, cfg);

            uint256 minRequiredDonation = _minRequiredDonation(actualProfit, cfg);
            donationAmount = KeeperSyncLib.computeDonationAmount(
                ext.traits.donateMode, ext.traits.donateParam, actualProfit, minRequiredDonation
            );
            keeperPayout = actualProfit > donationAmount ? actualProfit - donationAmount : 0;

            if (donationAmount > 0) {
                _donateToPool(key, intent.profitToken, donationAmount);
            }

            if (keeperPayout > 0) {
                _payoutKeeper(intent.profitToken, keeperPayout, ext, msg.sender);
            }
        } else {
            if (intent.expectedProfit > 0) revert ExternalSettlementRequired();
            actualProfit = 0;
            donationAmount = 0;
            keeperPayout = 0;
        }

        uint256 postDev =
            PoolSyncLib.poolDeviationFromTargetBps(poolId, poolManager, targetPriceScaled, scale);
        KeeperSyncLib.enforceMinImprovement(preDev, postDev, cfg);

        _recordSync(poolId, msg.sender, preDev, postDev);

        capitalReturned = _returnAllBalances(
            msg.sender, intent.capitalToken, intent.profitToken, expected.poolSwapTokenOut
        );

        emit KeeperIntentExecuted(
            poolId,
            msg.sender,
            intent.capitalAmount,
            capitalReturned,
            intent.expectedProfit,
            actualProfit,
            donationAmount,
            keeperPayout
        );
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback();

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

        revert UnknownUnlockAction(action);
    }

    function _fillPreview(
        SyncPreview memory preview,
        PoolKey memory key,
        PoolSyncLib.QuoteToTargetPlan memory plan,
        bytes32 poolId,
        uint256 targetPriceScaled,
        PriceScale memory scale,
        PoolConfig memory cfg
    ) private view {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);

        preview.targetPriceScaled = targetPriceScaled;
        preview.zeroForOne = plan.zeroForOne;
        preview.poolInputToReachTarget = plan.amountIn;
        preview.poolOutputToReachTarget = plan.amountOut;
        preview.poolDeviationBps =
            PoolSyncLib.poolDeviationFromTargetBps(poolId, poolManager, targetPriceScaled, scale);

        if (plan.zeroForOne) {
            preview.poolSwapTokenIn = currency0;
            preview.poolSwapTokenOut = currency1;
        } else {
            preview.poolSwapTokenIn = currency1;
            preview.poolSwapTokenOut = currency0;
        }
        preview.suggestedProfitToken = preview.poolSwapTokenIn;
        preview.keeperSwapFeeBps = uint24(cfg.minFeeBps);
    }

    function _previewFromPlan(
        PoolKey memory key,
        PoolSyncLib.QuoteToTargetPlan memory plan,
        bytes32 poolId,
        uint256 targetPriceScaled,
        PriceScale memory scale
    ) private view returns (SyncPreview memory preview) {
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);
        _fillPreview(preview, key, plan, poolId, targetPriceScaled, scale, cfg);
    }

    function _submitFeedUpdate(bytes32 poolId, bytes calldata feedPayload, PoolConfig memory cfg)
        internal
        returns (uint64 publishTime, uint32 qualityBps)
    {
        bytes[] memory updateData = abi.decode(feedPayload, (bytes[]));
        uint256 requiredFee = oracle.getUpdateFee(updateData);
        if (msg.value < requiredFee) revert InsufficientUpdateFee(requiredFee, msg.value);

        oracle.updatePriceFeeds{value: requiredFee}(updateData);

        PythStructs.Price memory p = PoolPriceLib.getConfiguredPrice(oracle, poolId, cfg);

        publishTime = uint64(p.publishTime);
        qualityBps = _qualityFromPublishTime(publishTime, cfg);
        feedKeepers.recordFeedUpdate(poolId, msg.sender, publishTime, qualityBps);
    }

    function _qualityFromPublishTime(uint64 publishTime, PoolConfig memory cfg)
        private
        view
        returns (uint32)
    {
        if (block.timestamp <= publishTime) return 10_000;
        uint256 age = block.timestamp - publishTime;
        if (age >= cfg.maxStalenessSec) return 0;
        return uint32(10_000 - (age * 10_000) / cfg.maxStalenessSec);
    }

    function _recordSync(bytes32 poolId, address keeper, uint256 preDev, uint256 postDev) internal {
        syncKeepers.recordSync(poolId, keeper, preDev, postDev);
    }

    function _validateProfitToken(PoolKey memory key, address profitToken) internal pure {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (profitToken != currency0 && profitToken != currency1) {
            revert TokenNotInPool(profitToken, currency0, currency1);
        }
    }

    function _returnAllBalances(
        address keeper,
        address capitalToken,
        address profitToken,
        address poolIntermediateToken
    ) internal returns (uint256 capitalReturned) {
        capitalReturned = _transferFullBalance(capitalToken, keeper);

        if (profitToken != capitalToken) {
            _transferFullBalance(profitToken, keeper);
        }

        if (poolIntermediateToken != capitalToken && poolIntermediateToken != profitToken) {
            _transferFullBalance(poolIntermediateToken, keeper);
        }
    }

    function _transferFullBalance(address token, address to) internal returns (uint256 amount) {
        amount = IERC20(token).balanceOf(address(this));
        if (amount > 0) {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _minRequiredDonation(uint256 arbProfit, PoolConfig memory cfg)
        internal
        pure
        returns (uint256)
    {
        if (cfg.minDonateBps == 0 || arbProfit == 0) return 0;
        return (arbProfit * cfg.minDonateBps) / PoolConfigLib.BPS;
    }

    function _executePoolSwap(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        bytes memory result = poolManager.unlock(
            abi.encode(
                UNLOCK_POOL_SWAP,
                abi.encode(
                    PoolSwapUnlockData({key: key, zeroForOne: zeroForOne, amountIn: amountIn})
                )
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    function _donateToPool(PoolKey memory key, address token, uint256 amount) internal {
        (uint256 amount0, uint256 amount1) = _donationAmounts(key, token, amount);

        IERC20(token).forceApprove(address(poolManager), amount);

        poolManager.unlock(
            abi.encode(
                UNLOCK_DONATE,
                abi.encode(DonateUnlockData({key: key, amount0: amount0, amount1: amount1}))
            )
        );
    }

    function _donationAmounts(PoolKey memory key, address token, uint256 amount)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);

        if (token == currency0) return (amount, 0);
        if (token == currency1) return (0, amount);
        revert TokenNotInPool(token, currency0, currency1);
    }

    function _payoutKeeper(
        address token,
        uint256 amount,
        KeeperExtension memory ext,
        address keeper
    ) internal {
        if (ext.traits.payoutType == PayoutMode.TREASURY_DEPOSIT) {
            if (address(keepersTreasury) == address(0)) {
                revert KeepersTreasuryNotConfigured();
            }
            IERC20(token).forceApprove(address(keepersTreasury), amount);
            keepersTreasury.depositForKeeper(
                KeeperSyncLib.resolveRecipient(ext.traits, keeper), token, amount
            );
            return;
        }

        address recipient = KeeperSyncLib.resolveRecipient(ext.traits, keeper);
        IERC20(token).safeTransfer(recipient, amount);
    }

}
