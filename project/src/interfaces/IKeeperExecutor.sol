// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IKeeperExecutor {

    struct SyncPreview {
        bool zeroForOne;
        address poolSwapTokenIn;
        address poolSwapTokenOut;
        /// @dev Hint; intent may use any pool token as profitToken.
        address suggestedProfitToken;
        uint256 poolInputToReachTarget;
        uint256 poolOutputToReachTarget;
        uint256 poolDeviationBps;
        uint256 targetPriceScaled;
        /// @dev Fee for keeper sync swap (cfg.minFeeBps, passed in hookData).
        uint24 keeperSwapFeeBps;
    }

    event FeedUpdateExecuted(
        bytes32 indexed poolId, address indexed keeper, uint64 publishTime, uint32 qualityBps
    );

    event KeeperIntentExecuted(
        bytes32 indexed poolId,
        address indexed keeper,
        uint256 capitalAmount,
        uint256 capitalReturned,
        uint256 expectedProfit,
        uint256 actualProfit,
        uint256 donationAmount,
        uint256 keeperPayout,
        uint256 capitalGainDonation,
        uint256 capitalGainKeeperPayout
    );

    /// @param capitalToken token keeper deposits for leg 1 (usually poolSwapTokenIn).
    /// @param profitToken token used to measure margin after full cycle (flexible: token0 or token1).
    struct KeeperIntent {
        bytes32 poolId;
        address capitalToken;
        uint256 capitalAmount;
        address profitToken;
        uint256 expectedProfit;
        bytes extension;
    }

    function previewSync(bytes32 poolId, uint256 targetPriceScaled, uint8 priceDecimals)
        external
        view
        returns (SyncPreview memory preview);

    /// @notice Pyth update + FeedKeepers record only (no pool sync).
    /// @param feedPayload `abi.encode(bytes[] updateData)` — same as `FeedUpdateData.payload`.
    function executeFeedOnly(bytes32 poolId, bytes calldata feedPayload)
        external
        payable
        returns (uint64 publishTime, uint32 qualityBps);

    function executeWithIntent(KeeperIntent calldata intent)
        external
        payable
        returns (
            uint256 actualProfit,
            uint256 donationAmount,
            uint256 keeperPayout,
            uint256 capitalReturned
        );

}
