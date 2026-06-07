// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FeedKeepers} from "src/core/FeedKeepers.sol";
import {KeeperExecutor} from "src/core/KeeperExecutor.sol";
import {KeeperExecutorLogic} from "src/core/KeeperExecutorLogic.sol";
import {KeeperExecutorViewLogic} from "src/core/KeeperExecutorViewLogic.sol";
import {KeepersTreasury} from "src/core/KeepersTreasury.sol";
import {PoolConfigRegistry} from "src/core/PoolConfigRegistry.sol";
import {SyncKeepers} from "src/core/SyncKeepers.sol";

struct CoreSystem {
    PoolConfigRegistry registry;
    FeedKeepers feedKeepers;
    SyncKeepers syncKeepers;
    KeepersTreasury keepersTreasury;
    KeeperExecutor executor;
}

library CoreSystemDeployer {

    function deploy(address owner, IPoolManager poolManager, IPyth oracle)
        internal
        returns (CoreSystem memory sys)
    {
        sys.registry = new PoolConfigRegistry(owner);
        sys.feedKeepers = new FeedKeepers(owner);
        sys.syncKeepers = new SyncKeepers(owner, sys.registry);
        sys.keepersTreasury = new KeepersTreasury(owner);
        KeeperExecutorLogic syncLogic = new KeeperExecutorLogic();
        KeeperExecutorViewLogic viewLogic = new KeeperExecutorViewLogic();
        sys.executor = new KeeperExecutor(
            owner,
            sys.registry,
            sys.feedKeepers,
            sys.syncKeepers,
            oracle,
            poolManager,
            sys.keepersTreasury,
            address(syncLogic),
            address(viewLogic)
        );
    }

}
