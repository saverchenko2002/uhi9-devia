// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolConfigBuilder} from "test/helpers/config/PoolConfigBuilder.t.sol";
import {PoolFeeLibWrapper} from "test/helpers/wrappers/PoolFeeLibWrapper.t.sol";

contract PoolFeeLib_FeedProviderAndDynamicFee_Test is Test {

    PoolFeeLibWrapper internal wrapper;

    function setUp() public {
        wrapper = new PoolFeeLibWrapper();
    }

    function test_resolvesFeedProvider_whenPublishTimesMatch() public view {
        address provider = wrapper.resolveFeedProvider(100, 100, address(0xBEEF));
        assertEq(provider, address(0xBEEF));
    }

    function test_rejectsFeedProvider_whenPublishTimesMismatch() public view {
        address provider = wrapper.resolveFeedProvider(101, 100, address(0xBEEF));
        assertEq(provider, address(0));
    }

    function test_dynamicFee_increasesWithStaleness() public view {
        uint256 poolPrice = TestConstants.ETH_USDT_PRICE_SCALED;
        uint256 oraclePrice = TestConstants.ETH_USDT_PRICE_SCALED;
        uint256 nowTs = 1000;

        (uint16 freshFee,,) = wrapper.computeFeeBpsFromPrices(
            nowTs, nowTs, poolPrice, oraclePrice, PoolConfigBuilder.defaultEthUsdtPool()
        );
        (uint16 staleFee,,) = wrapper.computeFeeBpsFromPrices(
            nowTs - 60, nowTs, poolPrice, oraclePrice, PoolConfigBuilder.defaultEthUsdtPool()
        );

        assertGt(staleFee, freshFee);
    }

}
