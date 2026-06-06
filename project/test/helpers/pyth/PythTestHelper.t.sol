// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity//PythStructs.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";

library PythTestHelper {

    function deployMockPyth() internal returns (MockPyth mock) {
        mock = new MockPyth(TestConstants.PYTH_VALID_TIME_PERIOD, TestConstants.PYTH_UPDATE_FEE);
    }

    function defaultEthUsdtOraclePrice() internal pure returns (int64) {
        return int64(uint64(TestConstants.ETH_USDT_PRICE_SCALED));
    }

    function encodeSingleUpdate(bytes32 feedId, int64 price, int32 expo, uint64 publishTime)
        internal
        pure
        returns (bytes memory updateData)
    {
        PythStructs.PriceFeed memory priceFeed;
        priceFeed.id = feedId;
        priceFeed.price =
            PythStructs.Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
        priceFeed.emaPrice = priceFeed.price;
        updateData = abi.encode(priceFeed);
    }

    function buildUpdatePayload(bytes memory singleUpdate)
        internal
        pure
        returns (bytes memory feedPayload)
    {
        bytes[] memory updates = new bytes[](1);
        updates[0] = singleUpdate;
        feedPayload = abi.encode(updates);
    }

    /// @dev ETH/USD update at `TestConstants.ETH_USDT_PRICE_SCALED`.
    function ethUsdtUpdate(uint64 publishTime) internal pure returns (bytes memory feedPayload) {
        return ethUsdtUpdateAtPrice(defaultEthUsdtOraclePrice(), publishTime);
    }

    function ethUsdtUpdateAtPrice(int64 price, uint64 publishTime)
        internal
        pure
        returns (bytes memory feedPayload)
    {
        bytes memory update = encodeSingleUpdate(
            TestConstants.ETH_USD_FEED_ID,
            price,
            -int32(int8(TestConstants.PRICE_DECIMALS)),
            publishTime
        );
        return buildUpdatePayload(update);
    }

    function seedEthUsdtPrice(MockPyth mock, uint64 publishTime) internal {
        seedEthUsdtPriceAt(mock, defaultEthUsdtOraclePrice(), publishTime);
    }

    function seedEthUsdtPriceAt(MockPyth mock, int64 price, uint64 publishTime) internal {
        bytes[] memory updates = new bytes[](1);
        updates[0] = encodeSingleUpdate(
            TestConstants.ETH_USD_FEED_ID,
            price,
            -int32(int8(TestConstants.PRICE_DECIMALS)),
            publishTime
        );
        mock.updatePriceFeeds{value: TestConstants.PYTH_UPDATE_FEE}(updates);
    }

}
