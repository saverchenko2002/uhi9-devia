// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {console2} from "forge-std/src/console2.sol";
import {PriceScale} from "src/types/PriceScaleTypes.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolPriceLibWrapper} from "test/helpers/wrappers/PoolPriceLibWrapper.t.sol";

contract PoolPriceLib_SqrtPriceX96Conversion_Test is Test {

    PoolPriceLibWrapper internal wrapper;

    function setUp() public {
        wrapper = new PoolPriceLibWrapper();
    }

    function test_sqrtPriceX96RecoversPriceScaled() public {
        PriceScale memory scale = PriceScale({
            token0Decimals: TestConstants.TOKEN0_DECIMALS,
            token1Decimals: TestConstants.TOKEN1_DECIMALS,
            priceDecimals: TestConstants.PRICE_DECIMALS
        });

        uint160 sqrt = wrapper.sqrtFromPriceScaled(TestConstants.ETH_USDT_PRICE_SCALED, scale);
        uint256 recovered = wrapper.priceScaledFromSqrt(sqrt, scale);

        console2.log(recovered);

        assertApproxEqRel(recovered, TestConstants.ETH_USDT_PRICE_SCALED, 1e18);
    }

}

