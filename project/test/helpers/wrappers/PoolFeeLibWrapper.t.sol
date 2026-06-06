// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolFeeLib} from "src/libs/PoolFeeLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

/// @dev Exposes internal PoolFeeLib functions for unit tests.
contract PoolFeeLibWrapper {

    function computeFeeBpsFromPrices(
        uint256 oracleUpdateTs,
        uint256 nowTs,
        uint256 poolPrice,
        uint256 oraclePrice,
        PoolConfig memory cfg
    ) external pure returns (uint16 feeBps, uint256 stale, uint256 dev) {
        return PoolFeeLib.computeFeeBpsFromPrices(
                oracleUpdateTs, nowTs, poolPrice, oraclePrice, cfg
            );
    }

    function resolveFeedProvider(
        uint64 pythPublishTime,
        uint64 feedPublishTime,
        address recordedProvider
    ) external pure returns (address) {
        return PoolFeeLib.resolveFeedProvider(pythPublishTime, feedPublishTime, recordedProvider);
    }

    function deviationBps(uint256 poolPrice, uint256 oraclePrice) external pure returns (uint256) {
        return PoolFeeLib.deviationBps(poolPrice, oraclePrice);
    }

}
