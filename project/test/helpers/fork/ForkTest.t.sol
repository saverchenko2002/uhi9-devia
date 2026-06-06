// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {Test} from "forge-std/src/Test.sol";
import {console2} from "forge-std/src/console2.sol";

import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolDeployer} from "test/helpers/deploy/PoolDeployer.t.sol";

abstract contract ForkTest is Test {

    MockPyth internal mockPyth;
    IPoolManager internal poolManager;

    function setUp() public virtual {
        vm.createSelectFork(vm.envString("RPC_MAINNET"));
        mockPyth = new MockPyth(TestConstants.PYTH_VALID_TIME_PERIOD, TestConstants.PYTH_UPDATE_FEE);
        poolManager = IPoolManager(TestConstants.POOL_MANAGER);
    }

    function _wireHookSystem(
        address hook,
        IFeedKeepers feedKeepers,
        ISyncKeepers syncKeepers,
        IPoolConfigRegistry registry,
        IKeepersTreasury treasury,
        IKeeperExecutor executor,
        address owner
    ) internal {
        vm.startPrank(owner);
        registry.setHook(address(hook), true);
        treasury.setHook(address(hook), true);

        feedKeepers.setExecutor(address(executor), true);
        syncKeepers.setExecutor(address(executor), true);
        treasury.setExecutor(address(executor), true);

        vm.stopPrank();
    }

    /// @dev Uses `TestConstants.DYNAMIC_FEE_HOOK_SALT` when set; otherwise mines once per call.
    function _deployDynamicFeeHook(
        IPoolConfigRegistry registry,
        IFeedKeepers feedKeepers,
        ISyncKeepers syncKeepers,
        IKeepersTreasury treasury,
        IKeeperExecutor executor
    ) internal returns (address hook) {
        bytes32 salt = TestConstants.DYNAMIC_FEE_HOOK_SALT;

        if (salt == bytes32(0)) {
            (, salt) = PoolDeployer.findDynamicFeeHookSalt(
                address(this),
                poolManager,
                registry,
                feedKeepers,
                syncKeepers,
                treasury,
                IPyth(address(mockPyth)),
                executor
            );
            console2.logBytes32(salt);
        }

        return address(
            PoolDeployer.deployDynamicFeeHookWithSalt(
                address(this),
                salt,
                poolManager,
                registry,
                feedKeepers,
                syncKeepers,
                treasury,
                IPyth(address(mockPyth)),
                executor
            )
        );
    }

}
