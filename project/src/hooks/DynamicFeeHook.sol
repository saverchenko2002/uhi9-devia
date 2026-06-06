// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseHook} from "@v4-hooks/src/base/BaseHook.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolFeeLib} from "src/libs/PoolFeeLib.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {UniswapV4Lib} from "src/libs/UniswapV4Lib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

/// @notice v4 hook: pool config, dynamic fee, keeper fee attribution context.
contract DynamicFeeHook is BaseHook {

    using PoolIdLibrary for PoolKey;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    IPoolConfigRegistry public immutable poolConfigRegistry;
    IFeedKeepers public immutable feedKeepers;
    ISyncKeepers public immutable syncKeepers;
    IKeepersTreasury public immutable keepersTreasury;
    IPyth public immutable oracle;

    address public keeperSyncExecutor;

    event PoolInitializedWithConfig(bytes32 indexed poolId, PoolConfig config);

    event SwapKeeperAttribution(
        bytes32 indexed poolId,
        uint64 pythPublishTime,
        uint64 feedKeepersPublishTime,
        address feedProviderEligible,
        bool feedShareEligible
    );

    struct PublicSwapFeeAccrual {
        PoolConfig cfg;
        address feeToken;
        uint256 totalFee;
        uint64 pythPublishTime;
    }

    struct SwapFeeContext {
        bytes32 poolId;
        PublicSwapFeeAccrual accrual;
        address feedProvider;
        address syncKeeper;
    }

    constructor(
        IPoolManager poolManager,
        IPoolConfigRegistry _poolConfigRegistry,
        IFeedKeepers _feedKeepers,
        ISyncKeepers _syncKeepers,
        IKeepersTreasury _keepersTreasury,
        IPyth _oracle,
        IKeeperExecutor _keeperSyncExecutor
    ) BaseHook(poolManager) {
        poolConfigRegistry = _poolConfigRegistry;
        feedKeepers = _feedKeepers;
        syncKeepers = _syncKeepers;
        keepersTreasury = _keepersTreasury;
        oracle = _oracle;
        keeperSyncExecutor = address(_keeperSyncExecutor);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _afterInitialize(address, PoolKey calldata key, uint160, int24)
        internal
        override
        returns (bytes4)
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        PoolConfig memory cfg = PoolConfigLib.defaultConfig();

        poolConfigRegistry.registerPool(poolId, key, cfg);

        emit PoolInitializedWithConfig(poolId, cfg);
        return BaseHook.afterInitialize.selector;
    }

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);

        if (_isKeeperSyncSwap(sender, hookData)) {
            return (
                BaseHook.beforeSwap.selector,
                BeforeSwapDeltaLibrary.ZERO_DELTA,
                uint24(cfg.minFeeBps)
            );
        }

        (uint256 poolPrice, uint256 oraclePrice, uint64 oracleTs) =
            _readOracleContext(poolId, key, cfg);

        (uint24 feeBps,,) = PoolFeeLib.computeFeeBpsFromPrices(
            oracleTs, block.timestamp, poolPrice, oraclePrice, cfg
        );

        (, address feedProvider) = _readFeedAttribution(poolId, oracleTs);
        address syncKeeper = _activeSyncKeeper(poolId);
        uint16 effectiveLpBps = PoolFeeLib.effectiveLpShareBps(
            feedProvider, syncKeeper, cfg.lpShareBps, cfg.syncShareBps, cfg.feedShareBps
        );
        feeBps = PoolFeeLib.lpFeeBpsFromEffectiveShare(feeBps, effectiveLpBps);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeBps);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        int128 hookDelta;

        _emitSwapKeeperAttribution(poolId, key);

        if (!_isKeeperSyncSwap(sender, hookData)) {
            hookDelta = _accruePublicSwapFee(poolId, key, params, delta);
        }

        return (BaseHook.afterSwap.selector, hookDelta);
    }

    function _emitSwapKeeperAttribution(bytes32 poolId, PoolKey calldata key) internal {
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);
        (,, uint64 pythPublishTime) = _readOracleContext(poolId, key, cfg);

        (uint64 feedPublishTime, address feedProvider) =
            _readFeedAttribution(poolId, pythPublishTime);

        emit SwapKeeperAttribution(
            poolId, pythPublishTime, feedPublishTime, feedProvider, feedProvider != address(0)
        );
    }

    function _accruePublicSwapFee(
        bytes32 poolId,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta
    ) internal returns (int128 hookDelta) {
        PublicSwapFeeAccrual memory accrual =
            _computePublicSwapFeeAccrual(poolId, key, params, delta);
        if (accrual.totalFee == 0 || accrual.feeToken == address(0)) return 0;

        return _depositPublicSwapFee(_swapFeeContext(poolId, accrual), key, params, delta);
    }

    function _swapFeeContext(bytes32 poolId, PublicSwapFeeAccrual memory accrual)
        internal
        view
        returns (SwapFeeContext memory ctx)
    {
        ctx.poolId = poolId;
        ctx.accrual = accrual;
        (, ctx.feedProvider) = _readFeedAttribution(poolId, accrual.pythPublishTime);
        ctx.syncKeeper = _activeSyncKeeper(poolId);
    }

    function _treasuryAccrue(SwapFeeContext memory ctx, address token, uint256 totalFee) internal {
        PoolConfig memory cfg = ctx.accrual.cfg;
        keepersTreasury.accrueSwapFee(
            ctx.poolId,
            token,
            totalFee,
            ctx.feedProvider,
            ctx.syncKeeper,
            cfg.lpShareBps,
            cfg.syncShareBps,
            cfg.feedShareBps
        );
    }

    function _depositPublicSwapFee(
        SwapFeeContext memory ctx,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta
    ) internal returns (int128 hookDelta) {
        PublicSwapFeeAccrual memory accrual = ctx.accrual;

        PoolFeeLib.SwapFeeSplit memory split = PoolFeeLib.splitSwapFee(
            accrual.totalFee,
            ctx.feedProvider,
            ctx.syncKeeper,
            accrual.cfg.lpShareBps,
            accrual.cfg.syncShareBps,
            accrual.cfg.feedShareBps
        );

        uint256 keeperTotalInFeeToken = split.syncAmount + split.feedAmount;
        if (keeperTotalInFeeToken == 0) {
            _treasuryAccrue(ctx, accrual.feeToken, accrual.totalFee);
            return 0;
        }

        (uint256 keeperTake, Currency takeCurrency) = PoolFeeLib.computeKeeperTakeUnspecified(
            key, params, delta, keeperTotalInFeeToken, accrual.feeToken
        );
        if (keeperTake == 0) {
            _treasuryAccrue(ctx, accrual.feeToken, accrual.totalFee);
            return 0;
        }

        return _takeKeeperFeeToTreasury(ctx, split, keeperTotalInFeeToken, keeperTake, takeCurrency);
    }

    function _takeKeeperFeeToTreasury(
        SwapFeeContext memory ctx,
        PoolFeeLib.SwapFeeSplit memory split,
        uint256 keeperTotalInFeeToken,
        uint256 keeperTake,
        Currency takeCurrency
    ) internal returns (int128 hookDelta) {
        address takeToken = Currency.unwrap(takeCurrency);
        uint256 totalFeeForAccrue =
            keeperTake + FullMath.mulDiv(split.lpAmount, keeperTake, keeperTotalInFeeToken);

        poolManager.take(takeCurrency, address(this), keeperTake);
        IERC20(takeToken).forceApprove(address(keepersTreasury), keeperTake);
        _treasuryAccrue(ctx, takeToken, totalFeeForAccrue);

        return keeperTake.toInt128();
    }

    function _computePublicSwapFeeAccrual(
        bytes32 poolId,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta
    ) internal view returns (PublicSwapFeeAccrual memory accrual) {
        accrual.cfg = poolConfigRegistry.getPoolConfig(poolId);

        uint64 pythPublishTime;
        uint24 feeBps;
        {
            (uint256 poolPrice, uint256 oraclePrice, uint64 oraclePublishTime) =
                _readOracleContext(poolId, key, accrual.cfg);
            pythPublishTime = oraclePublishTime;
            (feeBps,,) = PoolFeeLib.computeFeeBpsFromPrices(
                pythPublishTime, block.timestamp, poolPrice, oraclePrice, accrual.cfg
            );
        }

        accrual.pythPublishTime = pythPublishTime;
        (accrual.feeToken, accrual.totalFee) = PoolFeeLib.computeSwapFee(key, params, delta, feeBps);
    }

    function _readFeedAttribution(bytes32 poolId, uint64 pythPublishTime)
        internal
        view
        returns (uint64 feedPublishTime, address feedProvider)
    {
        feedPublishTime = feedKeepers.getLastPublishTime(poolId);
        feedProvider = PoolFeeLib.resolveFeedProvider(
            pythPublishTime, feedPublishTime, feedKeepers.getLastProvider(poolId)
        );
    }

    function _activeSyncKeeper(bytes32 poolId) internal view returns (address syncKeeper) {
        bool syncActive;
        (syncKeeper,,, syncActive) = syncKeepers.getActiveSyncKeeper(poolId);
        if (!syncActive) syncKeeper = address(0);
    }

    function _isKeeperSyncSwap(address sender, bytes calldata hookData)
        internal
        view
        returns (bool)
    {
        if (keeperSyncExecutor == address(0)) return false;
        if (sender != keeperSyncExecutor) return false;
        return UniswapV4Lib.isKeeperSyncSwap(hookData);
    }

    /// @dev Compare Pyth publishTime vs FeedKeepers publishTime for reward eligibility.
    function getEligibleFeedProvider(bytes32 poolId) external view returns (address) {
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);

        if (cfg.priceFeedId == bytes32(0)) return address(0);

        PythStructs.Price memory p = PoolPriceLib.getConfiguredPrice(oracle, poolId, cfg);
        uint64 feedPublishTime = feedKeepers.getLastPublishTime(poolId);

        return PoolFeeLib.resolveFeedProvider(
            uint64(p.publishTime), feedPublishTime, feedKeepers.getLastProvider(poolId)
        );
    }

    function _readOracleContext(bytes32 poolId, PoolKey calldata key, PoolConfig memory cfg)
        internal
        view
        returns (uint256 poolPrice, uint256 oraclePrice, uint64 oraclePublishTime)
    {
        PoolId poolIdTyped = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolIdTyped);

        oraclePublishTime = 0;

        if (cfg.priceFeedId == bytes32(0)) {
            PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, 0);
            poolPrice = PoolPriceLib.priceScaledFromSqrtPriceX96(sqrtPriceX96, scale);
            return (poolPrice, poolPrice, 0);
        }

        PythStructs.Price memory p = PoolPriceLib.getConfiguredPrice(oracle, poolId, cfg);
        uint8 priceDecimals = PoolPriceLib.pythPriceDecimals(p);
        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(key, priceDecimals);
        oraclePublishTime = uint64(p.publishTime);
        poolPrice = PoolPriceLib.priceScaledFromSqrtPriceX96(sqrtPriceX96, scale);
        oraclePrice = PoolPriceLib.priceScaledFromPyth(p, priceDecimals);
    }

}
