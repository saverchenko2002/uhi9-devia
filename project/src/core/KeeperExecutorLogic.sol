// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeeperExecutorCallbacks} from "src/interfaces/IKeeperExecutorCallbacks.sol";
import {IKeeperExecutorLogic} from "src/interfaces/IKeeperExecutorLogic.sol";

import {KeeperExecutorErrors} from "src/errors/KeeperExecutorErrors.sol";
import {KeeperExtension, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

import {KeeperSyncLib} from "src/libs/KeeperSyncLib.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PoolSyncLib} from "src/libs/PoolSyncLib.sol";

/// @dev `executeWithIntent` pipeline — deployed separately to keep both contracts under EIP-170.
contract KeeperExecutorLogic is IKeeperExecutorLogic {
    using KeeperSyncLib for bytes;
    using KeeperSyncLib for KeeperExtension;

    struct SyncExecutionContext {
        bytes32 poolId;
        KeeperExtension ext;
        PoolConfig cfg;
        PoolKey key;
        PriceScale scale;
        PoolSyncLib.QuoteToTargetPlan plan;
        IKeeperExecutor.SyncPreview expected;
        uint256 preDev;
        uint256 profitBaseline;
    }

    /// @inheritdoc IKeeperExecutorLogic
    function executeWithIntent(Env memory env, address keeper, IKeeperExecutor.KeeperIntent calldata intent)
        external
        payable
        returns (
            uint256 actualProfit,
            uint256 donationAmount,
            uint256 keeperPayout,
            uint256 capitalReturned
        )
    {
        SyncExecutionContext memory ctx = _prepareSyncContext(env, intent);
        _pullCapital(env, keeper, intent, ctx);
        actualProfit = _runArbAndMeasureProfit(env, intent, ctx);
        (donationAmount, keeperPayout) = _splitAndPayout(env, keeper, intent, ctx, actualProfit);
        (uint256 capitalGainDonation, uint256 capitalGainKeeperPayout) =
            _splitCapitalGain(env, keeper, intent, ctx);
        capitalReturned = _finalizeSync(env, keeper, intent, ctx);

        emit IKeeperExecutor.KeeperIntentExecuted(
            ctx.poolId,
            keeper,
            intent.capitalAmount,
            capitalReturned,
            intent.expectedProfit,
            actualProfit,
            donationAmount,
            keeperPayout,
            capitalGainDonation,
            capitalGainKeeperPayout
        );
    }

    function _prepareSyncContext(Env memory env, IKeeperExecutor.KeeperIntent calldata intent)
        private
        view
        returns (SyncExecutionContext memory ctx)
    {
        ctx.poolId = intent.poolId;
        ctx.ext = intent.extension.decode();
        ctx.cfg = env.poolConfigRegistry.getPoolConfig(ctx.poolId);
        ctx.key = env.poolConfigRegistry.getPoolKey(ctx.poolId);
        ctx.scale = PoolPriceLib.priceScaleFromPoolKey(ctx.key, ctx.ext.sync.priceDecimals);

        KeeperSyncLib.validateDonatePolicy(ctx.ext, ctx.cfg);
        if (!ctx.ext.hasSync()) revert KeeperExecutorErrors.SyncActionRequired();

        uint256 targetPriceScaled = ctx.ext.sync.targetPriceScaled;
        ctx.plan = PoolSyncLib.planQuoteSwapToTarget(
            ctx.poolId, env.poolManager, targetPriceScaled, ctx.cfg, ctx.scale
        );
        ctx.expected = _previewFromPlan(env, ctx.key, ctx.plan, ctx.poolId, targetPriceScaled, ctx.scale);

        if (intent.capitalToken != ctx.expected.poolSwapTokenIn) {
            revert KeeperExecutorErrors.CapitalTokenMismatch(
                ctx.expected.poolSwapTokenIn, intent.capitalToken
            );
        }
        _validateProfitToken(ctx.key, intent.profitToken);

        if (intent.capitalAmount < ctx.plan.amountIn) {
            revert KeeperExecutorErrors.InsufficientCapital(ctx.plan.amountIn, intent.capitalAmount);
        }

        ctx.preDev = ctx.expected.poolDeviationBps;
    }

    function _pullCapital(
        Env memory env,
        address keeper,
        IKeeperExecutor.KeeperIntent calldata intent,
        SyncExecutionContext memory ctx
    ) private {
        ctx.profitBaseline = IERC20(intent.profitToken).balanceOf(env.executor);
        IKeeperExecutorCallbacks(env.executor).executorPullCapital(
            intent.capitalToken, keeper, intent.capitalAmount
        );
    }

    function _runArbAndMeasureProfit(
        Env memory env,
        IKeeperExecutor.KeeperIntent calldata intent,
        SyncExecutionContext memory ctx
    ) private returns (uint256 actualProfit) {
        uint256 amountOut = IKeeperExecutorCallbacks(env.executor).executorPoolSwap(
            ctx.key, ctx.plan.zeroForOne, ctx.plan.amountIn
        );

        (address executor, bytes memory externalCalldata) =
            KeeperSyncLib.decodeExternalSwap(ctx.ext.sync.externalSwap);

        IKeeperExecutorCallbacks(env.executor).executorApprove(
            ctx.expected.poolSwapTokenOut, executor, amountOut
        );

        bool ok = IKeeperExecutorCallbacks(env.executor).executorExternalCall(executor, externalCalldata);
        if (!ok) revert KeeperExecutorErrors.ExecutionCallFailed();

        actualProfit = _measureProfit(env, intent, ctx);
        KeeperSyncLib.enforceSyncSlippage(intent.expectedProfit, actualProfit, ctx.cfg);
    }

    function _measureProfit(
        Env memory env,
        IKeeperExecutor.KeeperIntent calldata intent,
        SyncExecutionContext memory ctx
    ) private view returns (uint256 actualProfit) {
        uint256 profitAfter = IERC20(intent.profitToken).balanceOf(env.executor);

        if (intent.capitalToken == intent.profitToken) {
            if (profitAfter <= ctx.profitBaseline + intent.capitalAmount) {
                revert KeeperExecutorErrors.NonPositiveArbProfit(
                    profitAfter - ctx.profitBaseline - intent.capitalAmount
                );
            }
            actualProfit = profitAfter - ctx.profitBaseline - intent.capitalAmount;
        } else {
            if (profitAfter <= ctx.profitBaseline) {
                revert KeeperExecutorErrors.NonPositiveArbProfit(profitAfter - ctx.profitBaseline);
            }
            actualProfit = profitAfter - ctx.profitBaseline;
        }
    }

    function _splitAndPayout(
        Env memory env,
        address keeper,
        IKeeperExecutor.KeeperIntent calldata intent,
        SyncExecutionContext memory ctx,
        uint256 actualProfit
    ) private returns (uint256 donationAmount, uint256 keeperPayout) {
        uint256 minRequiredDonation = _minRequiredDonation(actualProfit, ctx.cfg);
        donationAmount = KeeperSyncLib.computeDonationAmount(
            ctx.ext.traits.donateMode, ctx.ext.traits.donateParam, actualProfit, minRequiredDonation
        );
        keeperPayout = actualProfit > donationAmount ? actualProfit - donationAmount : 0;

        if (donationAmount > 0) {
            IKeeperExecutorCallbacks(env.executor).executorDonate(ctx.key, intent.profitToken, donationAmount);
        }

        if (keeperPayout > 0) {
            _payoutKeeper(env, intent.profitToken, keeperPayout, ctx.ext, keeper);
        }
    }

    /// @dev When capital and profit are different tokens, arb gain also accrues in capital
    /// (e.g. WETH surplus on pool-above path). Apply the same donate policy to that gain.
    function _splitCapitalGain(
        Env memory env,
        address keeper,
        IKeeperExecutor.KeeperIntent calldata intent,
        SyncExecutionContext memory ctx
    ) private returns (uint256 capitalDonation, uint256 capitalKeeperPayout) {
        if (intent.capitalToken == intent.profitToken) return (0, 0);

        uint256 capitalBalance = IERC20(intent.capitalToken).balanceOf(env.executor);
        if (capitalBalance <= intent.capitalAmount) return (0, 0);

        uint256 capitalGain = capitalBalance - intent.capitalAmount;
        uint256 minRequiredDonation = _minRequiredDonation(capitalGain, ctx.cfg);
        capitalDonation = KeeperSyncLib.computeDonationAmount(
            ctx.ext.traits.donateMode, ctx.ext.traits.donateParam, capitalGain, minRequiredDonation
        );
        capitalKeeperPayout = capitalGain > capitalDonation ? capitalGain - capitalDonation : 0;

        if (capitalDonation > 0) {
            IKeeperExecutorCallbacks(env.executor).executorDonate(
                ctx.key, intent.capitalToken, capitalDonation
            );
        }

        if (capitalKeeperPayout > 0) {
            _payoutKeeper(env, intent.capitalToken, capitalKeeperPayout, ctx.ext, keeper);
        }
    }

    function _finalizeSync(
        Env memory env,
        address keeper,
        IKeeperExecutor.KeeperIntent calldata intent,
        SyncExecutionContext memory ctx
    ) private returns (uint256 capitalReturned) {
        uint256 postDev = PoolSyncLib.poolDeviationFromTargetBps(
            ctx.poolId, env.poolManager, ctx.ext.sync.targetPriceScaled, ctx.scale
        );
        KeeperSyncLib.enforceMinImprovement(ctx.preDev, postDev, ctx.cfg);

        IKeeperExecutorCallbacks(env.executor).executorRecordSync(ctx.poolId, keeper, ctx.preDev, postDev);

        capitalReturned = _returnAllBalances(
            env, keeper, intent.capitalToken, intent.profitToken, ctx.expected.poolSwapTokenOut
        );
    }

    function _fillPreview(
        IKeeperExecutor.SyncPreview memory preview,
        Env memory env,
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
            PoolSyncLib.poolDeviationFromTargetBps(poolId, env.poolManager, targetPriceScaled, scale);

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
        Env memory env,
        PoolKey memory key,
        PoolSyncLib.QuoteToTargetPlan memory plan,
        bytes32 poolId,
        uint256 targetPriceScaled,
        PriceScale memory scale
    ) private view returns (IKeeperExecutor.SyncPreview memory preview) {
        PoolConfig memory cfg = env.poolConfigRegistry.getPoolConfig(poolId);
        _fillPreview(preview, env, key, plan, poolId, targetPriceScaled, scale, cfg);
    }

    function _validateProfitToken(PoolKey memory key, address profitToken) private pure {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (profitToken != currency0 && profitToken != currency1) {
            revert KeeperExecutorErrors.TokenNotInPool(profitToken, currency0, currency1);
        }
    }

    function _returnAllBalances(
        Env memory env,
        address keeper,
        address capitalToken,
        address profitToken,
        address poolIntermediateToken
    ) private returns (uint256 capitalReturned) {
        capitalReturned = _transferFullBalance(env, capitalToken, keeper);

        if (profitToken != capitalToken) {
            _transferFullBalance(env, profitToken, keeper);
        }

        if (poolIntermediateToken != capitalToken && poolIntermediateToken != profitToken) {
            _transferFullBalance(env, poolIntermediateToken, keeper);
        }
    }

    function _transferFullBalance(Env memory env, address token, address to)
        private
        returns (uint256 amount)
    {
        amount = IKeeperExecutorCallbacks(env.executor).executorSafeTransferFull(token, to);
    }

    function _minRequiredDonation(uint256 arbProfit, PoolConfig memory cfg)
        private
        pure
        returns (uint256)
    {
        if (cfg.minDonateBps == 0 || arbProfit == 0) return 0;
        return (arbProfit * cfg.minDonateBps) / PoolConfigLib.BPS;
    }

    function _payoutKeeper(
        Env memory env,
        address token,
        uint256 amount,
        KeeperExtension memory ext,
        address keeper
    ) private {
        if (ext.traits.payoutType == PayoutMode.TREASURY_DEPOSIT) {
            if (address(env.keepersTreasury) == address(0)) {
                revert KeeperExecutorErrors.KeepersTreasuryNotConfigured();
            }
            IKeeperExecutorCallbacks(env.executor).executorTreasuryDeposit(
                KeeperSyncLib.resolveRecipient(ext.traits, keeper), token, amount
            );
            return;
        }

        address recipient = KeeperSyncLib.resolveRecipient(ext.traits, keeper);
        IKeeperExecutorCallbacks(env.executor).executorSafeTransfer(token, recipient, amount);
    }
}
