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
import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {DynamicFeeLib} from "src/libs/DynamicFeeLib.sol";
import {KeeperPythFeedLib} from "src/libs/KeeperPythFeedLib.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PythOracleLib} from "src/libs/PythOracleLib.sol";
import {PythPriceLib} from "src/libs/PythPriceLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PythPrice} from "src/types/PythTypes.sol";

/// @notice v4 hook: pool config, dynamic fee, keeper fee attribution context.
contract DynamicFeeHook is BaseHook {

    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolConfigRegistry public immutable poolConfigRegistry;
    IFeedKeepers public immutable feedKeepers;
    IPyth public immutable oracle;

    event PoolInitializedWithConfig(bytes32 indexed poolId, PoolConfig config);

    event SwapKeeperAttribution(
        bytes32 indexed poolId,
        uint64 pythPublishTime,
        uint64 feedKeepersPublishTime,
        address feedProviderEligible,
        bool feedShareEligible
    );

    constructor(
        IPoolManager poolManager,
        IPoolConfigRegistry _poolConfigRegistry,
        IFeedKeepers _feedKeepers,
        IPyth _oracle
    ) BaseHook(poolManager) {
        poolConfigRegistry = _poolConfigRegistry;
        feedKeepers = _feedKeepers;
        oracle = _oracle;
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

        poolConfigRegistry.registerPool(poolId, cfg);

        emit PoolInitializedWithConfig(poolId, cfg);
        return BaseHook.afterInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);

        (uint256 poolPriceX96, uint256 oraclePriceX96, uint64 oracleTs) =
            _readOracleContext(poolId, key, cfg);

        (uint24 feeBps,,) = DynamicFeeLib.computeFeeBpsFromPrices(
            oracleTs, block.timestamp, poolPriceX96, oraclePriceX96, cfg
        );

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeBps);
    }

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);

        (,, uint64 pythPublishTime) = _readOracleContext(poolId, key, cfg);

        uint64 feedPublishTime = feedKeepers.getLastPublishTime(poolId);
        address recordedProvider = feedKeepers.getLastProvider(poolId);

        address feedProvider = KeeperPythFeedLib.resolveFeedProvider(
            pythPublishTime, feedPublishTime, recordedProvider
        );

        emit SwapKeeperAttribution(
            poolId, pythPublishTime, feedPublishTime, feedProvider, feedProvider != address(0)
        );

        // TODO: accrue swap fee shares (LP / feed / sync) via treasury using feedProvider
        return (BaseHook.afterSwap.selector, 0);
    }

    /// @dev Compare Pyth publishTime vs FeedKeepers publishTime for reward eligibility.
    function getEligibleFeedProvider(bytes32 poolId) external view returns (address) {
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);

        if (cfg.priceFeedId == bytes32(0)) return address(0);

        PythPrice memory p = PythOracleLib.getConfiguredPrice(oracle, poolId, cfg);
        uint64 feedPublishTime = feedKeepers.getLastPublishTime(poolId);

        return KeeperFeeAttributionLib.resolveFeedProvider(
            uint64(p.publishTime), feedPublishTime, feedKeepers.getLastProvider(poolId)
        );
    }

    function _readOracleContext(bytes32 poolId, PoolKey calldata key, PoolConfig memory cfg)
        internal
        view
        returns (uint256 poolPriceX96, uint256 oraclePriceX96, uint64 oraclePublishTime)
    {
        PoolId poolIdTyped = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolIdTyped);
        poolPriceX96 = _sqrtPriceX96ToPriceX96(sqrtPriceX96);

        oraclePriceX96 = poolPriceX96;
        oraclePublishTime = 0;

        if (cfg.priceFeedId != bytes32(0)) {
            PythPrice memory p = PythOracleLib.getConfiguredPrice(oracle, poolId, cfg);
            oraclePublishTime = uint64(p.publishTime);
            oraclePriceX96 = PythPriceLib.toPriceX96(p);
        }
    }

    function _sqrtPriceX96ToPriceX96(uint160 sqrtPriceX96) private pure returns (uint256) {
        uint256 sp = uint256(sqrtPriceX96);
        return (sp * sp) >> 96;
    }

}
