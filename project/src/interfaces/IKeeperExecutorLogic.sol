// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";

interface IKeeperExecutorLogic {
    struct Env {
        address executor;
        IPoolConfigRegistry poolConfigRegistry;
        IFeedKeepers feedKeepers;
        ISyncKeepers syncKeepers;
        IPyth oracle;
        IPoolManager poolManager;
        IKeepersTreasury keepersTreasury;
    }

    function executeWithIntent(Env memory env, address keeper, IKeeperExecutor.KeeperIntent calldata intent)
        external
        payable
        returns (
            uint256 actualProfit,
            uint256 donationAmount,
            uint256 keeperPayout,
            uint256 capitalReturned
        );
}
