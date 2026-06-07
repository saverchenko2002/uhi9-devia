// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeeperExecutorCallbacks} from "src/interfaces/IKeeperExecutorCallbacks.sol";
import {IKeeperExecutorLogic} from "src/interfaces/IKeeperExecutorLogic.sol";
import {IKeeperExecutorViewLogic} from "src/interfaces/IKeeperExecutorViewLogic.sol";

import {KeeperExecutorErrors} from "src/errors/KeeperExecutorErrors.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PoolSyncLib} from "src/libs/PoolSyncLib.sol";

/// @dev Preview + feed paths — kept separate so KeeperExecutor stays under EIP-170.
contract KeeperExecutorViewLogic is IKeeperExecutorViewLogic {
    /// @inheritdoc IKeeperExecutorViewLogic
    function previewSync(
        IKeeperExecutorLogic.Env memory env,
        bytes32 poolId,
        uint256 targetPriceScaled,
        uint8 priceDecimals
    ) external view returns (IKeeperExecutor.SyncPreview memory preview) {
        PoolKey memory key = env.poolConfigRegistry.getPoolKey(poolId);
        PoolConfig memory cfg = env.poolConfigRegistry.getPoolConfig(poolId);
        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, priceDecimals);

        PoolSyncLib.QuoteToTargetPlan memory plan =
            PoolSyncLib.planQuoteSwapToTarget(poolId, env.poolManager, targetPriceScaled, cfg, scale);

        _fillPreview(preview, env, key, plan, poolId, targetPriceScaled, scale, cfg);
    }

    /// @inheritdoc IKeeperExecutorViewLogic
    function executeFeedOnly(
        IKeeperExecutorLogic.Env memory env,
        address keeper,
        bytes32 poolId,
        bytes calldata feedPayload
    ) external payable returns (uint64 publishTime, uint32 qualityBps) {
        if (msg.sender != env.executor) revert KeeperExecutorErrors.UnauthorizedLogic();
        if (feedPayload.length == 0) revert KeeperExecutorErrors.EmptyFeedPayload();

        PoolConfig memory cfg = env.poolConfigRegistry.getPoolConfig(poolId);
        PoolConfigLib.requirePriceFeedId(poolId, cfg);

        (publishTime, qualityBps) = _submitFeedUpdate(env, keeper, poolId, feedPayload, cfg);

        emit IKeeperExecutor.FeedUpdateExecuted(poolId, keeper, publishTime, qualityBps);
    }

    function _fillPreview(
        IKeeperExecutor.SyncPreview memory preview,
        IKeeperExecutorLogic.Env memory env,
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

    function _submitFeedUpdate(
        IKeeperExecutorLogic.Env memory env,
        address keeper,
        bytes32 poolId,
        bytes calldata feedPayload,
        PoolConfig memory cfg
    ) private returns (uint64 publishTime, uint32 qualityBps) {
        bytes[] memory updateData = abi.decode(feedPayload, (bytes[]));
        uint256 requiredFee = env.oracle.getUpdateFee(updateData);
        if (msg.value < requiredFee) {
            revert KeeperExecutorErrors.InsufficientUpdateFee(requiredFee, msg.value);
        }

        env.oracle.updatePriceFeeds{value: requiredFee}(updateData);

        PythStructs.Price memory p = PoolPriceLib.getConfiguredPrice(env.oracle, poolId, cfg);

        publishTime = uint64(p.publishTime);
        qualityBps = _qualityFromPublishTime(publishTime, cfg);
        IKeeperExecutorCallbacks(env.executor).executorRecordFeedUpdate(
            poolId, keeper, publishTime, qualityBps
        );
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
}
