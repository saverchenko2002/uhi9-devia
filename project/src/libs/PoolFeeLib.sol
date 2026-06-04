// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

/// @notice Dynamic swap fee, notional fee на свапе, feed keeper attribution.
library PoolFeeLib {

    uint256 internal constant PIPS_DENOMINATOR = 1_000_000;

    error ZeroOraclePrice();

    // --- dynamic fee (hook beforeSwap) ---

    function stalenessSec(uint256 oracleUpdateTs, uint256 nowTs) internal pure returns (uint256) {
        if (nowTs <= oracleUpdateTs) return 0;
        return nowTs - oracleUpdateTs;
    }

    function deviationBps(uint256 poolPrice, uint256 oraclePrice) internal pure returns (uint256) {
        if (oraclePrice == 0) revert ZeroOraclePrice();

        if (poolPrice >= oraclePrice) {
            return ((poolPrice - oraclePrice) * PoolConfigLib.BPS) / oraclePrice;
        }

        return ((oraclePrice - poolPrice) * PoolConfigLib.BPS) / oraclePrice;
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
        uint256 poolPrice,
        uint256 oraclePrice,
        PoolConfig memory cfg
    ) internal pure returns (uint16 feeBps, uint256 stale, uint256 dev) {
        stale = stalenessSec(oracleUpdateTs, nowTs);
        dev = deviationBps(poolPrice, oraclePrice);
        feeBps = computeFeeBps(stale, dev, cfg);
    }

    // --- swap notional fee (hook afterSwap / treasury) ---

    function computeSwapFee(
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        uint24 feeBps
    ) internal pure returns (address feeToken, uint256 feeAmount) {
        if (feeBps == 0) return (address(0), 0);

        bool isExactInput = params.amountSpecified < 0;

        if (isExactInput) {
            uint256 amountIn = uint256(-params.amountSpecified);
            feeAmount = FullMath.mulDivRoundingUp(amountIn, feeBps, PIPS_DENOMINATOR);
            feeToken = Currency.unwrap(params.zeroForOne ? key.currency0 : key.currency1);
            return (feeToken, feeAmount);
        }

        int128 amount0 = BalanceDeltaLibrary.amount0(delta);
        int128 amount1 = BalanceDeltaLibrary.amount1(delta);
        uint256 amountIn;

        if (params.zeroForOne) {
            amountIn = amount0 < 0 ? uint256(uint128(-amount0)) : uint256(uint128(amount0));
            feeToken = Currency.unwrap(key.currency0);
        } else {
            amountIn = amount1 < 0 ? uint256(uint128(-amount1)) : uint256(uint128(amount1));
            feeToken = Currency.unwrap(key.currency1);
        }

        feeAmount = FullMath.mulDivRoundingUp(amountIn, feeBps, PIPS_DENOMINATOR - feeBps);
    }

    // --- feed keeper eligibility ---

    function isLegitFeedProvider(uint64 pythPublishTime, uint64 feedKeepersPublishTime)
        internal
        pure
        returns (bool)
    {
        if (feedKeepersPublishTime == 0) return false;
        return pythPublishTime == feedKeepersPublishTime;
    }

    function resolveFeedProvider(
        uint64 pythPublishTime,
        uint64 feedKeepersPublishTime,
        address recordedProvider
    ) internal pure returns (address feedProvider) {
        if (!isLegitFeedProvider(pythPublishTime, feedKeepersPublishTime)) {
            return address(0);
        }
        return recordedProvider;
    }

}
