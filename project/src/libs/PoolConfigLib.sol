// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolConfig} from "src/types/PoolConfigTypes.sol";

library PoolConfigLib {

    // --- shared scales ---
    uint16 internal constant BPS = 10_000;
    uint32 internal constant PPM = 1_000_000;

    // --- default dynamic fee (template for new pools) ---
    uint16 internal constant BASE_FEE_BPS = 30;
    uint16 internal constant MIN_FEE_BPS = 5;
    uint16 internal constant MAX_FEE_BPS = 200;
    uint32 internal constant STALENESS_SLOPE_PPM_PER_SEC = 35_000;
    uint32 internal constant DEVIATION_SLOPE_PPM_PER_BPS = 7_000;
    uint32 internal constant MAX_STALENESS_SEC = 180;

    // --- default keeper policy ---
    uint16 internal constant DEFAULT_MIN_DONATE_BPS = 0;
    uint16 internal constant DEFAULT_MAX_DONATE_BPS = BPS;
    uint16 internal constant DEFAULT_MIN_IMPROVEMENT_BPS = 5;
    uint16 internal constant DEFAULT_MIN_OVERWRITE_IMPROVEMENT_BPS = 3;
    uint16 internal constant DEFAULT_MAX_SLIPPAGE_BPS = 50;

    // --- default fee split (80 / 15 / 5) ---
    uint16 internal constant DEFAULT_LP_SHARE_BPS = 8000;
    uint16 internal constant DEFAULT_SYNC_SHARE_BPS = 1500;
    uint16 internal constant DEFAULT_FEED_SHARE_BPS = 500;

    error InvalidFeeBounds();
    error InvalidShareSplit();
    error InvalidPolicyBounds();
    error PoolDisabled();
    error PriceFeedNotConfigured(bytes32 poolId);

    function validate(PoolConfig memory cfg) internal pure {
        if (!cfg.enabled) revert PoolDisabled();

        if (cfg.minFeeBps > cfg.baseFeeBps || cfg.baseFeeBps > cfg.maxFeeBps) {
            revert InvalidFeeBounds();
        }

        if (
            cfg.maxDonateBps == 0 || cfg.maxDonateBps > BPS || cfg.minDonateBps > cfg.maxDonateBps
                || cfg.minImprovementBps > BPS || cfg.minOverwriteImprovementBps > BPS
                || cfg.maxSlippageBps > BPS
        ) {
            revert InvalidPolicyBounds();
        }

        if (uint256(cfg.lpShareBps) + uint256(cfg.syncShareBps) + uint256(cfg.feedShareBps) != BPS)
        {
            revert InvalidShareSplit();
        }
    }

    function defaultConfig() internal pure returns (PoolConfig memory cfg) {
        cfg = PoolConfig({
            baseFeeBps: BASE_FEE_BPS,
            minFeeBps: MIN_FEE_BPS,
            maxFeeBps: MAX_FEE_BPS,
            stalenessSlopePpmPerSec: STALENESS_SLOPE_PPM_PER_SEC,
            deviationSlopePpmPerBps: DEVIATION_SLOPE_PPM_PER_BPS,
            maxStalenessSec: MAX_STALENESS_SEC,
            minDonateBps: DEFAULT_MIN_DONATE_BPS,
            maxDonateBps: DEFAULT_MAX_DONATE_BPS,
            minImprovementBps: DEFAULT_MIN_IMPROVEMENT_BPS,
            minOverwriteImprovementBps: DEFAULT_MIN_OVERWRITE_IMPROVEMENT_BPS,
            maxSlippageBps: DEFAULT_MAX_SLIPPAGE_BPS,
            lpShareBps: DEFAULT_LP_SHARE_BPS,
            syncShareBps: DEFAULT_SYNC_SHARE_BPS,
            feedShareBps: DEFAULT_FEED_SHARE_BPS,
            priceFeedId: bytes32(0),
            enabled: true
        });
    }

    /// @dev Pool may be registered with zero feed id; feed path must revert until configured.
    function requirePriceFeedId(bytes32 poolId, PoolConfig memory cfg) internal pure {
        if (cfg.priceFeedId == bytes32(0)) revert PriceFeedNotConfigured(poolId);
    }

}
