// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IKeeperExecutor {

    struct SyncPreview {
        bool zeroForOne;
        address poolSwapTokenIn;
        address poolSwapTokenOut;
        /// @dev Подсказка; в intent можно указать любой токен пула как profitToken.
        address suggestedProfitToken;
        uint256 poolInputToReachTarget;
        uint256 poolOutputToReachTarget;
        uint256 poolDeviationBps;
        uint256 targetPriceScaled;
        /// @dev Fee для sync-свапа кипера (cfg.minFeeBps, передаётся в hookData).
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

    /// @param capitalToken токен, который keeper вносит для ноги 1 (обычно = poolSwapTokenIn).
    /// @param profitToken токен, в котором считается маржа после полного цикла (гибко: token0 или token1).
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

    /// @notice Только обновление Pyth + запись в FeedKeepers (без pool sync).
    /// @param feedPayload `abi.encode(bytes[] updateData)` — как `FeedUpdateData.payload`.
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
