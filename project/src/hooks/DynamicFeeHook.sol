// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseHook} from "@v4-hooks/src/base/BaseHook.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
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
            afterSwapReturnDelta: false,
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

        _emitSwapKeeperAttribution(poolId, key);

        if (!_isKeeperSyncSwap(sender, hookData)) {
            _accruePublicSwapFee(poolId, key, params, delta);
        }

        return (BaseHook.afterSwap.selector, 0);
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
    ) internal {
        PublicSwapFeeAccrual memory accrual =
            _computePublicSwapFeeAccrual(poolId, key, params, delta);
        if (accrual.totalFee == 0 || accrual.feeToken == address(0)) return;

        _depositPublicSwapFee(poolId, accrual);
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

    function _depositPublicSwapFee(bytes32 poolId, PublicSwapFeeAccrual memory accrual) internal {
        (, address feedProvider) = _readFeedAttribution(poolId, accrual.pythPublishTime);
        address syncKeeper = _activeSyncKeeper(poolId);

        keepersTreasury.accrueSwapFee(
            poolId,
            accrual.feeToken,
            accrual.totalFee,
            feedProvider,
            syncKeeper,
            accrual.cfg.lpShareBps,
            accrual.cfg.syncShareBps,
            accrual.cfg.feedShareBps
        );
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
