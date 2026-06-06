// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {PoolFeeLib} from "src/libs/PoolFeeLib.sol";
import {PoolPriceLib} from "src/libs/PoolPriceLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";

library DynamicFeeTestHelper {

    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function readHookFeeBps(
        IPoolManager poolManager,
        PoolKey memory poolKey,
        IPyth oracle,
        PoolConfig memory cfg,
        uint8 priceDecimals
    ) internal view returns (uint16 feeBps) {
        bytes32 poolId = PoolId.unwrap(poolKey.toId());
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());

        PriceScale memory scale = PoolPriceLib.priceScaleFromPoolKey(poolKey, priceDecimals);
        uint256 poolPrice = PoolPriceLib.priceScaledFromSqrtPriceX96(sqrtPriceX96, scale);

        PythStructs.Price memory p = PoolPriceLib.getConfiguredPrice(oracle, poolId, cfg);
        uint256 oraclePrice = PoolPriceLib.priceScaledFromPyth(p, priceDecimals);

        (feeBps,,) = PoolFeeLib.computeFeeBpsFromPrices(
            uint64(p.publishTime), block.timestamp, poolPrice, oraclePrice, cfg
        );
    }

}
