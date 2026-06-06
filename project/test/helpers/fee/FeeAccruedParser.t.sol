// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/src/Vm.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";

/// @dev Parses `KeepersTreasury.FeeAccrued` logs emitted during public swaps on hooked pools.
library FeeAccruedParser {

    bytes32 internal constant FEE_ACCRUED_TOPIC =
        keccak256("FeeAccrued(bytes32,address,uint256,uint256,uint256,uint256,address,address)");

    /// @dev Raw fee amounts split by fee token (WETH for token0-in swaps, USDT for token1-in swaps).
    struct Totals {
        uint256 wethTotalFee;
        uint256 wethLpShare;
        uint256 wethSyncShare;
        uint256 wethFeedShare;
        uint256 usdtTotalFee;
        uint256 usdtLpShare;
        uint256 usdtSyncShare;
        uint256 usdtFeedShare;
    }

    /// @dev Fee totals valued in USDT at `priceScaled` (token1 per token0).
    struct ValuedTotals {
        uint256 totalFeeUsdt;
        uint256 lpShareUsdt;
        uint256 syncShareUsdt;
        uint256 feedShareUsdt;
    }

    function accumulate(Vm.Log[] memory logs, bytes32 poolId, Totals memory running)
        internal
        pure
        returns (Totals memory updated)
    {
        updated = running;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length < 2) continue;
            if (logs[i].topics[0] != FEE_ACCRUED_TOPIC) continue;
            if (logs[i].topics[1] != poolId) continue;

            (
                address token,
                uint256 totalFee,
                uint256 lpShare,
                uint256 syncShare,
                uint256 feedShare
            ) = abi.decode(logs[i].data, (address, uint256, uint256, uint256, uint256));

            if (token == TestConstants.WETH) {
                updated.wethTotalFee += totalFee;
                updated.wethLpShare += lpShare;
                updated.wethSyncShare += syncShare;
                updated.wethFeedShare += feedShare;
            } else if (token == TestConstants.USDT) {
                updated.usdtTotalFee += totalFee;
                updated.usdtLpShare += lpShare;
                updated.usdtSyncShare += syncShare;
                updated.usdtFeedShare += feedShare;
            }
        }
    }

    function merge(Totals memory a, Totals memory b) internal pure returns (Totals memory merged) {
        merged.wethTotalFee = a.wethTotalFee + b.wethTotalFee;
        merged.wethLpShare = a.wethLpShare + b.wethLpShare;
        merged.wethSyncShare = a.wethSyncShare + b.wethSyncShare;
        merged.wethFeedShare = a.wethFeedShare + b.wethFeedShare;
        merged.usdtTotalFee = a.usdtTotalFee + b.usdtTotalFee;
        merged.usdtLpShare = a.usdtLpShare + b.usdtLpShare;
        merged.usdtSyncShare = a.usdtSyncShare + b.usdtSyncShare;
        merged.usdtFeedShare = a.usdtFeedShare + b.usdtFeedShare;
    }

    function valueInUsdt(Totals memory fees, uint256 priceScaled)
        internal
        pure
        returns (ValuedTotals memory valued)
    {
        valued.totalFeeUsdt = _toUsdt(fees.wethTotalFee, fees.usdtTotalFee, priceScaled);
        valued.lpShareUsdt = _toUsdt(fees.wethLpShare, fees.usdtLpShare, priceScaled);
        valued.syncShareUsdt = _toUsdt(fees.wethSyncShare, fees.usdtSyncShare, priceScaled);
        valued.feedShareUsdt = _toUsdt(fees.wethFeedShare, fees.usdtFeedShare, priceScaled);
    }

    function _toUsdt(uint256 wethAmount, uint256 usdtAmount, uint256 priceScaled)
        private
        pure
        returns (uint256)
    {
        return usdtAmount + TestConstants.usdtForWethAtPrice(wethAmount, priceScaled);
    }

}
