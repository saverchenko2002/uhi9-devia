// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {DonateMode, KeeperExtension} from "src/types/KeeperExtensionTypes.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

library FeePolicyLib {

    error InvalidDonateParam();
    error ImprovementTooSmall(uint256 got, uint256 minRequired);
    error OverwriteImprovementTooSmall(uint256 got, uint256 minRequired);
    error OracleTooStale(uint256 ageSec, uint256 maxStalenessSec);
    error SyncSlippageTooHigh(uint256 gotBps, uint256 maxAllowedBps);

    function validateDonatePolicy(KeeperExtension memory ext, PoolConfig memory cfg) internal pure {
        if (ext.traits.donateMode == DonateMode.SPECIFIED_BPS) {
            uint16 p = ext.traits.donateParam;
            if (p < cfg.minDonateBps || p > cfg.maxDonateBps) revert InvalidDonateParam();
        }
    }

    function enforceMinImprovement(
        uint256 preDeviationBps,
        uint256 postDeviationBps,
        PoolConfig memory cfg
    ) internal pure {
        if (preDeviationBps <= postDeviationBps) {
            revert ImprovementTooSmall(0, cfg.minImprovementBps);
        }

        uint256 improvement = preDeviationBps - postDeviationBps;
        if (improvement < cfg.minImprovementBps) {
            revert ImprovementTooSmall(improvement, cfg.minImprovementBps);
        }
    }

    function enforceMinOverwriteImprovement(
        uint256 oldQualityBps,
        uint256 newQualityBps,
        PoolConfig memory cfg
    ) internal pure {
        if (newQualityBps <= oldQualityBps) {
            revert OverwriteImprovementTooSmall(0, cfg.minOverwriteImprovementBps);
        }

        uint256 improvement = newQualityBps - oldQualityBps;
        if (improvement < cfg.minOverwriteImprovementBps) {
            revert OverwriteImprovementTooSmall(improvement, cfg.minOverwriteImprovementBps);
        }
    }

    function enforceOracleFreshness(uint256 oracleUpdateTs, uint256 nowTs, PoolConfig memory cfg)
        internal
        pure
    {
        if (nowTs <= oracleUpdateTs) return;

        uint256 age = nowTs - oracleUpdateTs;
        if (age > cfg.maxStalenessSec) revert OracleTooStale(age, cfg.maxStalenessSec);
    }

    function enforceSyncSlippage(uint256 expectedOut, uint256 gotOut, PoolConfig memory cfg)
        internal
        pure
    {
        if (expectedOut == 0) revert SyncSlippageTooHigh(type(uint256).max, cfg.maxSlippageBps);
        if (gotOut >= expectedOut) return;

        uint256 slippageBps = ((expectedOut - gotOut) * PoolConfigLib.BPS) / expectedOut;
        if (slippageBps > cfg.maxSlippageBps) {
            revert SyncSlippageTooHigh(slippageBps, cfg.maxSlippageBps);
        }
    }

}
