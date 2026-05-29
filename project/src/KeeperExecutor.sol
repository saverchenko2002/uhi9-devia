// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

import {BaseUpgradeable} from "src/base/BaseUpgradeable.sol";
import {IFeedKeepers} from "src/interfaces/IFeedKeepers.sol";
import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {IPoolConfigRegistry} from "src/interfaces/IPoolConfigRegistry.sol";
import {ISyncKeepers} from "src/interfaces/ISyncKeepers.sol";

import {KeeperExtension} from "src/types/KeeperExtensionTypes.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

import {DonationLib} from "src/libs/DonationLib.sol";
import {FeePolicyLib} from "src/libs/FeePolicyLib.sol";
import {KeeperExecutionLib} from "src/libs/KeeperExecutionLib.sol";
import {KeeperExtensionLib} from "src/libs/KeeperExtensionLib.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PythOracleLib} from "src/libs/PythOracleLib.sol";

contract KeeperExecutor is IKeeperExecutor, BaseUpgradeable {

    using SafeERC20 for IERC20;
    using KeeperExtensionLib for bytes;
    using KeeperExtensionLib for KeeperExtension;

    IPoolConfigRegistry public poolConfigRegistry;
    IFeedKeepers public feedKeepers;
    ISyncKeepers public syncKeepers;
    IPyth public oracle;

    mapping(bytes32 poolId => uint256) public lastSyncBlock;

    error SyncAlreadyInBlock(bytes32 poolId);
    error ExecutionCallFailed();
    error InsufficientUpdateFee(uint256 required, uint256 provided);
    error SyncActionRequired();
    error InvalidExecutionReturn();

    function initialize(
        address owner,
        IPoolConfigRegistry _poolConfigRegistry,
        IFeedKeepers _feedKeepers,
        ISyncKeepers _syncKeepers,
        IPyth _oracle
    ) external initializer {
        __Base_init();
        _transferOwnership(owner);
        poolConfigRegistry = _poolConfigRegistry;
        feedKeepers = _feedKeepers;
        syncKeepers = _syncKeepers;
    }

    /// @inheritdoc IKeeperExecutor
    function executeWithIntent(KeeperIntent calldata intent)
        external
        payable
        returns (uint256 actualOut, uint256 donationAmount, uint256 keeperReturn)
    {
        bytes32 poolId = intent.poolId;
        KeeperExtension memory ext = intent.extension.decode();
        PoolConfig memory cfg = poolConfigRegistry.getPoolConfig(poolId);

        FeePolicyLib.validateDonatePolicy(ext, cfg);

        if (ext.hasFeedUpdate()) {
            _submitFeedUpdate(poolId, ext, cfg);
        }

        if (!ext.hasSync()) revert SyncActionRequired();

        if (lastSyncBlock[poolId] == block.number) revert SyncAlreadyInBlock(poolId);
        lastSyncBlock[poolId] = block.number;

        IERC20(intent.tokenIn).safeTransferFrom(msg.sender, address(this), intent.amountIn);

        uint256 targetPriceX96 = ext.sync.targetPriceX96;
        uint256 preDev = _deviationToTargetBps(poolId, targetPriceX96);

        (address executor, bytes memory execCalldata) =
            KeeperExecutionLib.decode(ext.sync.keeperExecution);

        uint256 balanceOutBefore = IERC20(intent.tokenOut).balanceOf(address(this));

        (bool ok,) = executor.call(execCalldata);
        if (!ok) revert ExecutionCallFailed();

        uint256 balanceOutAfter = IERC20(intent.tokenOut).balanceOf(address(this));
        if (balanceOutAfter < balanceOutBefore) revert InvalidExecutionReturn();
        actualOut = balanceOutAfter - balanceOutBefore;

        FeePolicyLib.enforceSyncSlippage(intent.expectedOut, actualOut, cfg);

        uint256 postDev = _deviationToTargetBps(poolId, targetPriceX96);
        FeePolicyLib.enforceMinImprovement(preDev, postDev, cfg);

        _recordSync(poolId, msg.sender, preDev, postDev);

        uint256 neededOutForTarget =
            _neededOutForTarget(poolId, intent.tokenIn, intent.tokenOut, targetPriceX96);
        uint256 surplus = actualOut > neededOutForTarget ? actualOut - neededOutForTarget : 0;

        uint256 minRequiredSurplus = _minRequiredDonationSurplus(poolId, surplus);
        donationAmount = DonationLib.computeDonationAmount(
            ext.traits.donateMode, ext.traits.donateParam, surplus, minRequiredSurplus
        );
        keeperReturn = surplus > donationAmount ? surplus - donationAmount : 0;

        if (donationAmount > 0) {
            _donateToPool(poolId, intent.tokenOut, donationAmount);
        }

        if (keeperReturn > 0) {
            _payoutKeeper(intent.tokenOut, keeperReturn, ext, msg.sender);
        }

        emit KeeperIntentExecuted(
            poolId,
            msg.sender,
            intent.amountIn,
            intent.expectedOut,
            actualOut,
            donationAmount,
            keeperReturn
        );
    }

    // --- internal hooks (TODO: wire to v4 pool math / feed / treasury) ---

    function _submitFeedUpdate(bytes32 poolId, KeeperExtension memory ext, PoolConfig memory cfg)
        internal
    {
        bytes[] memory updateData = abi.decode(ext.feed.payload, (bytes[]));

        bytes[] memory updateData = abi.decode(ext.feed.payload, (bytes[]));
        uint256 requiredFee = oracle.getUpdateFee(updateData);

        if (msg.value < requiredFee) revert InsufficientUpdateFee(requiredFee, msg.value);

        oracle.updatePriceFeeds{value: requiredFee}(updateData);

        PythPrice memory p = PythOracleLib.getConfiguredPrice(oracle, poolId, cfg);

        FeePolicyLib.enforceOracleFreshness(uint64(p.publishTime), block.timestamp, cfg);

        uint32 qualityBps = _qualityFromPublishTime(uint64(p.publishTime));

        feedKeepers.recordFeedUpdate(poolId, msg.sender, uint64(p.publishTime), qualityBps);
    }

    function _recordSync(bytes32 poolId, address keeper, uint256 preDev, uint256 postDev) internal {
        poolId;
        keeper;
        preDev;
        postDev;
        // TODO: syncKeepers.recordSync(poolId, keeper, preDev, postDev);
    }

    function _qualityFromPublishTime(uint64 publishTime) private view returns (uint32) {
        if (block.timestamp <= publishTime) return 10_000;
        uint256 age = block.timestamp - publishTime;
        if (age >= 180) return 0;
        return uint32(10_000 - (age * 10_000) / 180);
    }

    function _deviationToTargetBps(bytes32 poolId, uint256 targetPriceX96)
        internal
        view
        returns (uint256)
    {
        poolId;
        targetPriceX96;
        // TODO: read pool sqrtPriceX96 and compare to target
        revert("TODO_DEVIATION");
    }

    function _neededOutForTarget(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 targetPriceX96
    ) internal view returns (uint256) {
        poolId;
        tokenIn;
        tokenOut;
        targetPriceX96;
        // TODO: v4 tick math — output required to reach target price
        revert("TODO_NEEDED_OUT");
    }

    function _minRequiredDonationSurplus(bytes32 poolId, uint256 surplus)
        internal
        view
        returns (uint256)
    {
        poolId;
        surplus;
        return 0;
    }

    function _donateToPool(bytes32 poolId, address token, uint256 amount) internal {
        poolId;
        token;
        amount;
        // TODO: donate to v4 pool (increase reserves for LP)
        revert("TODO_DONATE_TO_POOL");
    }

    function _payoutKeeper(
        address token,
        uint256 amount,
        KeeperExtension memory ext,
        address keeper
    ) internal {
        address recipient = KeeperExtensionLib.resolveRecipient(ext.traits, keeper);
        token;
        amount;
        recipient;
        ext;
        // TODO: apply PayoutMode (WRAPPED / UNWRAPPED / TREASURY_DEPOSIT)
        revert("TODO_PAYOUT");
    }

}
