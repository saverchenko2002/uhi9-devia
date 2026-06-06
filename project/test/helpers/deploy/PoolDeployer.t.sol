// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {HookMiner} from "@v4-hooks/src/utils/HookMiner.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {DynamicFeeHook} from "src/hooks/DynamicFeeHook.sol";
import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";

library PoolDeployer {

    using PoolIdLibrary for PoolKey;

    error HookAddressMismatch();

    function dynamicFeeHookFlags() internal pure returns (uint160) {
        return uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
    }

    function encodeDynamicFeeHookConstructorArgs(
        IPoolManager poolManager,
        IPoolConfigRegistry registry,
        IFeedKeepers feedKeepers,
        ISyncKeepers syncKeepers,
        IKeepersTreasury treasury,
        IPyth oracle,
        IKeeperExecutor executor
    ) internal pure returns (bytes memory constructorArgs) {
        return abi.encode(
            poolManager, registry, feedKeepers, syncKeepers, treasury, oracle, executor
        );
    }

    /// @dev Run once, persist salt in `TestConstants.DYNAMIC_FEE_HOOK_SALT` to skip mining in CI.
    function findDynamicFeeHookSalt(address deployer, bytes memory constructorArgs)
        internal
        view
        returns (address expected, bytes32 salt)
    {
        return HookMiner.find(
            deployer, dynamicFeeHookFlags(), type(DynamicFeeHook).creationCode, constructorArgs
        );
    }

    function findDynamicFeeHookSalt(
        address deployer,
        IPoolManager poolManager,
        IPoolConfigRegistry registry,
        IFeedKeepers feedKeepers,
        ISyncKeepers syncKeepers,
        IKeepersTreasury treasury,
        IPyth oracle,
        IKeeperExecutor executor
    ) internal view returns (address expected, bytes32 salt) {
        return findDynamicFeeHookSalt(
            deployer,
            encodeDynamicFeeHookConstructorArgs(
                poolManager, registry, feedKeepers, syncKeepers, treasury, oracle, executor
            )
        );
    }

    function deployDynamicFeeHookWithSalt(
        address deployer,
        bytes32 salt,
        IPoolManager poolManager,
        IPoolConfigRegistry registry,
        IFeedKeepers feedKeepers,
        ISyncKeepers syncKeepers,
        IKeepersTreasury treasury,
        IPyth oracle,
        IKeeperExecutor keeperExecutor
    ) internal returns (DynamicFeeHook hook) {
        bytes memory constructorArgs = encodeDynamicFeeHookConstructorArgs(
            poolManager, registry, feedKeepers, syncKeepers, treasury, oracle, keeperExecutor
        );

        bytes memory creationCodeWithArgs =
            abi.encodePacked(type(DynamicFeeHook).creationCode, constructorArgs);
        address expected = HookMiner.computeAddress(deployer, uint256(salt), creationCodeWithArgs);

        hook = new DynamicFeeHook{salt: salt}(
            poolManager, registry, feedKeepers, syncKeepers, treasury, oracle, keeperExecutor
        );

        if (address(hook) != expected) revert HookAddressMismatch();
    }

    function deployDynamicFeeHook(
        address deployer,
        IPoolManager poolManager,
        IPoolConfigRegistry registry,
        IFeedKeepers feedKeepers,
        ISyncKeepers syncKeepers,
        IKeepersTreasury treasury,
        IPyth oracle,
        IKeeperExecutor keeperExecutor
    ) internal returns (DynamicFeeHook hook) {
        (, bytes32 salt) = findDynamicFeeHookSalt(
            deployer,
            poolManager,
            registry,
            feedKeepers,
            syncKeepers,
            treasury,
            oracle,
            keeperExecutor
        );
        return deployDynamicFeeHookWithSalt(
            deployer,
            salt,
            poolManager,
            registry,
            feedKeepers,
            syncKeepers,
            treasury,
            oracle,
            keeperExecutor
        );
    }

    /// @dev Initializes WETH/USDT pool (token0=WETH, token1=USDT) with dynamic fee + hook.
    function createWethUsdtPool(IPoolManager poolManager, address hook, uint160 sqrtPriceX96)
        internal
        returns (PoolKey memory key, bytes32 poolId)
    {
        (address token0, address token1) = sortTokens(TestConstants.WETH, TestConstants.USDT);

        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TestConstants.POOL_TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        poolId = PoolId.unwrap(key.toId());
        poolManager.initialize(key, sqrtPriceX96);
    }

    /// @dev (matches `PoolConfigLib.BASE_FEE_BPS`), no hook.
    function createPlainWethUsdtPool(IPoolManager poolManager, uint160 sqrtPriceX96)
        internal
        returns (PoolKey memory key, bytes32 poolId)
    {
        (address token0, address token1) = sortTokens(TestConstants.WETH, TestConstants.USDT);

        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: plainPoolStaticFee(),
            tickSpacing: TestConstants.POOL_TICK_SPACING,
            hooks: IHooks(address(0))
        });

        poolId = PoolId.unwrap(key.toId());
        poolManager.initialize(key, sqrtPriceX96);
    }

    /// @dev 0.30% LP fee in Uniswap v4 pips (same nominal rate as default dynamic base fee).
    function plainPoolStaticFee() internal pure returns (uint24) {
        return PoolConfigLib.BASE_FEE_BPS;
    }

    /// @dev WETH (token0) / USDT (token1) at ~3000 USDT per 1 WETH.
    function wethUsdtSqrtPriceX96() internal pure returns (uint160) {
        PriceScale memory scale = PriceScale({
            token0Decimals: TestConstants.TOKEN0_DECIMALS,
            token1Decimals: TestConstants.TOKEN1_DECIMALS,
            priceDecimals: TestConstants.PRICE_DECIMALS
        });
        return PoolPriceLib.sqrtPriceX96FromPriceScaled(TestConstants.ETH_USDT_PRICE_SCALED, scale);
    }

    function sortTokens(address tokenA, address tokenB)
        internal
        pure
        returns (address token0, address token1)
    {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

}
