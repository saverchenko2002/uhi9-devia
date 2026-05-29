// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {Price} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

library PythOracleLib {

    /// @notice Reads Pyth price with pool-configured max staleness (getPriceNoOlderThan).
    function getConfiguredPrice(IPyth oracle, bytes32 poolId, PoolConfig memory cfg)
        internal
        view
        returns (PythPrice memory price)
    {
        PoolConfigLib.requirePriceFeedId(poolId, cfg);
        return oracle.getPriceNoOlderThan(cfg.priceFeedId, cfg.maxStalenessSec);
    }

}
