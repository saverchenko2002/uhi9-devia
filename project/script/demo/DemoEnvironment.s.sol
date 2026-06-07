// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/src/Script.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {CoreSystem, CoreSystemDeployer} from "test/helpers/deploy/CoreSystemDeployer.t.sol";
import {PoolConfigBuilder} from "test/helpers/config/PoolConfigBuilder.t.sol";
import {PoolDeployer} from "test/helpers/deploy/PoolDeployer.t.sol";
import {PoolLiquidityRouter} from "test/helpers/liquidity/PoolLiquidityRouter.t.sol";
import {PoolSwapRouter} from "test/helpers/swap/PoolSwapRouter.t.sol";
import {PythTestHelper} from "test/helpers/pyth/PythTestHelper.t.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {MockRouter} from "test/mocks/MockRouter.t.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@v4-hooks/src/utils/HookMiner.sol";

import {DynamicFeeHook} from "src/hooks/DynamicFeeHook.sol";
import {Create2Deployer} from "script/demo/Create2Deployer.sol";

/// @dev One-shot demo bootstrap. Run against an Anvil mainnet fork (see demo/README.md).
///      `deployments.json` is assembled by demo/server from broadcast + pool id files.
contract DemoEnvironment is Script {

    address internal constant OWNER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    bytes32 internal hookedPoolId;
    bytes32 internal plainPoolId;

    function run() external {
        _deployAll();
        _writePoolIds();
        console2.log("Demo environment ready");
    }

    function _deployAll() internal {
        vm.startBroadcast(OWNER);

        address mockPyth = address(new MockPyth(TestConstants.PYTH_VALID_TIME_PERIOD, TestConstants.PYTH_UPDATE_FEE));
        IPoolManager poolManager = IPoolManager(TestConstants.POOL_MANAGER);

        CoreSystem memory sys = CoreSystemDeployer.deploy(OWNER, poolManager, IPyth(mockPyth));

        address hook = _deployHook(sys, mockPyth);
        _wireHook(sys, hook);

        (, hookedPoolId) =
            PoolDeployer.createWethUsdtPool(poolManager, hook, PoolDeployer.wethUsdtSqrtPriceX96());
        (, plainPoolId) = PoolDeployer.createPlainWethUsdtPool(poolManager, PoolDeployer.wethUsdtSqrtPriceX96());

        sys.registry.updatePoolConfig(hookedPoolId, PoolConfigBuilder.defaultEthUsdtPool());

        new PoolLiquidityRouter(poolManager);
        new PoolSwapRouter(poolManager);
        new MockRouter();

        PythTestHelper.seedEthUsdtPrice(MockPyth(mockPyth), uint64(block.timestamp));

        vm.stopBroadcast();
    }

    function _wireHook(CoreSystem memory sys, address hook) internal {
        sys.registry.setHook(hook, true);
        sys.keepersTreasury.setHook(hook, true);
        sys.feedKeepers.setExecutor(address(sys.executor), true);
        sys.syncKeepers.setExecutor(address(sys.executor), true);
        sys.keepersTreasury.setExecutor(address(sys.executor), true);
    }

    function _deployHook(CoreSystem memory sys, address mockPyth) internal returns (address hook) {
        IPoolManager poolManager = IPoolManager(TestConstants.POOL_MANAGER);
        IPyth oracle = IPyth(mockPyth);

        address hookDeployerAddr = vm.computeCreateAddress(OWNER, vm.getNonce(OWNER));
        Create2Deployer hookDeployer = new Create2Deployer();
        if (address(hookDeployer) != hookDeployerAddr) revert("hook deployer address mismatch");

        bytes memory constructorArgs = abi.encode(
            poolManager,
            sys.registry,
            sys.feedKeepers,
            sys.syncKeepers,
            sys.keepersTreasury,
            oracle,
            sys.executor
        );
        bytes memory initCode = abi.encodePacked(type(DynamicFeeHook).creationCode, constructorArgs);

        bytes32 salt = TestConstants.DYNAMIC_FEE_HOOK_SALT;
        if (salt == bytes32(0)) {
            uint160 flags = uint160(
                Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                    | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
            );
            (, salt) = HookMiner.find(hookDeployerAddr, flags, type(DynamicFeeHook).creationCode, constructorArgs);
        }

        hook = hookDeployer.deploy(salt, initCode);
    }

    function _writePoolIds() internal {
        vm.writeFile("../demo/hooked_pool_id.txt", vm.toString(hookedPoolId));
        vm.writeFile("../demo/plain_pool_id.txt", vm.toString(plainPoolId));
    }

}
