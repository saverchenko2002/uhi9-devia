// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IKeeperExecutorLogic} from "src/interfaces/IKeeperExecutorLogic.sol";

interface IKeeperExecutorViewLogic {
    function previewSync(
        IKeeperExecutorLogic.Env memory env,
        bytes32 poolId,
        uint256 targetPriceScaled,
        uint8 priceDecimals
    ) external view returns (IKeeperExecutor.SyncPreview memory preview);

    function executeFeedOnly(
        IKeeperExecutorLogic.Env memory env,
        address keeper,
        bytes32 poolId,
        bytes calldata feedPayload
    ) external payable returns (uint64 publishTime, uint32 qualityBps);
}
