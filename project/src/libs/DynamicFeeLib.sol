// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

library DynamicFeeLib {

    error ZeroOraclePrice();

    function stalenessSec(uint256 oracleUpdateTs, uint256 nowTs) internal pure returns (uint256) {
        if (nowTs <= oracleUpdateTs) return 0;
        return nowTs - oracleUpdateTs;
    }

    function deviationBps(uint256 poolPriceX96, uint256 oraclePriceX96)
        internal
        pure
        returns (uint256)
    {
        if (oraclePriceX96 == 0) revert ZeroOraclePrice();

        if (poolPriceX96 >= oraclePriceX96) {
            return ((poolPriceX96 - oraclePriceX96) * PoolConfigLib.BPS) / oraclePriceX96;
        }

        return ((oraclePriceX96 - poolPriceX96) * PoolConfigLib.BPS) / oraclePriceX96;
    }

    function computeFeeBps(uint256 staleness, uint256 deviation)
        internal
        pure
        returns (uint16 feeBps)
    {
        feeBps = computeFeeBps(staleness, deviation, PoolConfigLib.defaultConfig());
    }

    function computeFeeBps(uint256 staleness, uint256 deviation, PoolConfig memory cfg)
        internal
        pure
        returns (uint16 feeBps)
    {
        uint256 addFromStaleness =
            (staleness * cfg.stalenessSlopePpmPerSec) / PoolConfigLib.PPM;
        uint256 addFromDeviation = (deviation * cfg.deviationSlopePpmPerBps) / PoolConfigLib.PPM;

        uint256 raw = uint256(cfg.baseFeeBps) + addFromStaleness + addFromDeviation;

        if (raw < cfg.minFeeBps) raw = cfg.minFeeBps;
        if (raw > cfg.maxFeeBps) raw = cfg.maxFeeBps;

        feeBps = uint16(raw);
    }

    function computeFeeBpsFromPrices(
        uint256 oracleUpdateTs,
        uint256 nowTs,
        uint256 poolPriceX96,
        uint256 oraclePriceX96
    ) internal pure returns (uint16 feeBps, uint256 stale, uint256 dev) {
        (feeBps, stale, dev) = computeFeeBpsFromPrices(
            oracleUpdateTs, nowTs, poolPriceX96, oraclePriceX96, PoolConfigLib.defaultConfig()
        );
    }

    function computeFeeBpsFromPrices(
        uint256 oracleUpdateTs,
        uint256 nowTs,
        uint256 poolPriceX96,
        uint256 oraclePriceX96,
        PoolConfig memory cfg
    ) internal pure returns (uint16 feeBps, uint256 stale, uint256 dev) {
        stale = stalenessSec(oracleUpdateTs, nowTs);
        dev = deviationBps(poolPriceX96, oraclePriceX96);
        feeBps = computeFeeBps(stale, dev, cfg);
    }

}
