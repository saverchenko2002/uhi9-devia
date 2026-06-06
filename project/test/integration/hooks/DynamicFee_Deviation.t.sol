// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Vm} from "forge-std/src/Vm.sol";

import {IKeeperExecutor} from "src/interfaces/IKeeperExecutor.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {DonateMode, PayoutMode} from "src/types/KeeperExtensionTypes.sol";
import {DynamicFeeTestHelper} from "test/helpers/fee/DynamicFeeTestHelper.t.sol";
import {PythTestHelper} from "test/helpers/pyth/PythTestHelper.t.sol";
import {TestConstants} from "test/helpers/TestConstants.t.sol";
import {PoolSwapRouter} from "test/helpers/swap/PoolSwapRouter.t.sol";
import {
    ExecuteWithIntentTestBase
} from "test/integration/core/KeeperExecutor/base/ExecuteWithIntentTestBase.t.sol";

contract DynamicFee_Deviation_Test is ExecuteWithIntentTestBase {

    using SafeERC20 for IERC20;

    PoolSwapRouter internal swapRouter;

    uint256 internal constant SWAP_USDT_IN = 10_000e6;

    bytes32 internal constant FEE_ACCRUED_TOPIC =
        keccak256("FeeAccrued(bytes32,address,uint256,uint256,uint256,uint256,address,address)");

    function setUp() public override {
        super.setUp();
        _setUpSyncPool();
        swapRouter = new PoolSwapRouter(poolManager);
    }

    function test_feeBps_equalsBaseWhenOracleMatchesPool() public view {
        assertEq(_readCurrentFeeBps(), PoolConfigLib.BASE_FEE_BPS);
    }

    function test_feeBps_exceedsBaseWhenOracleAbovePool() public {
        uint16 alignedFee = _readCurrentFeeBps();

        _seedOracleAtTarget();

        uint16 deviatedFee = _readCurrentFeeBps();

        assertEq(alignedFee, PoolConfigLib.BASE_FEE_BPS);
        assertGt(deviatedFee, alignedFee);
    }

    function test_publicSwap_accruesHigherFeeWhenOracleDeviates() public {
        uint256 alignedFee = _publicSwapTotalFee(SWAP_USDT_IN);

        _seedOracleAtTarget();

        uint256 deviatedFee = _publicSwapTotalFee(SWAP_USDT_IN);
        assertGt(deviatedFee, alignedFee);
    }

    function test_publicSwap_emitsFeeAccrued() public {
        assertGt(_publicSwapTotalFee(SWAP_USDT_IN), 0);
    }

    function test_keeperSyncSwap_doesNotAccrueTreasurySwapFee() public {
        _seedOracleAtTarget();

        vm.recordLogs();
        _executeKeeperSyncArb();
        assertEq(_countFeeAccrued(vm.getRecordedLogs()), 0);
    }

    function test_keeperSyncSwap_usesMinFeeBelowDeviationFee() public {
        _seedOracleAtTarget();

        uint16 deviatedFee = DynamicFeeTestHelper.readHookFeeBps(
            poolManager,
            poolKey,
            mockPyth,
            sys.registry.getPoolConfig(poolId),
            TestConstants.PRICE_DECIMALS
        );

        assertGt(deviatedFee, PoolConfigLib.MIN_FEE_BPS);
        assertEq(PoolConfigLib.MIN_FEE_BPS, sys.registry.getPoolConfig(poolId).minFeeBps);
    }

    function _seedOracleAtTarget() internal {
        vm.warp(block.timestamp + 1);
        PythTestHelper.seedEthUsdtPriceAt(
            mockPyth,
            int64(uint64(TestConstants.ETH_USDT_PRICE_SCALED_TARGET)),
            uint64(block.timestamp)
        );
    }

    function _readCurrentFeeBps() internal view returns (uint16) {
        return DynamicFeeTestHelper.readHookFeeBps(
            poolManager,
            poolKey,
            mockPyth,
            sys.registry.getPoolConfig(poolId),
            TestConstants.PRICE_DECIMALS
        );
    }

    function _publicSwapTotalFee(uint256 amountIn) internal returns (uint256 totalFee) {
        deal(TestConstants.USDT, syncKeeper, amountIn);

        vm.startPrank(syncKeeper);
        IERC20(TestConstants.USDT).forceApprove(address(swapRouter), amountIn);
        vm.recordLogs();
        swapRouter.swapExactIn(poolKey, false, amountIn, "", syncKeeper);
        vm.stopPrank();

        totalFee = _parseFeeAccruedTotal(vm.getRecordedLogs());
    }

    function _parseFeeAccruedTotal(Vm.Log[] memory logs) internal view returns (uint256 totalFee) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length < 2) continue;
            if (logs[i].topics[0] != FEE_ACCRUED_TOPIC) continue;
            if (logs[i].topics[1] != poolId) continue;

            (,, totalFee,,) = abi.decode(logs[i].data, (address, uint256, uint256, uint256, uint256));
            return totalFee;
        }

        revert("FeeAccrued not found");
    }

    function _countFeeAccrued(Vm.Log[] memory logs) internal view returns (uint256 count) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length < 2) continue;
            if (logs[i].topics[0] != FEE_ACCRUED_TOPIC) continue;
            if (logs[i].topics[1] != poolId) continue;
            count++;
        }
    }

    function _executeKeeperSyncArb()
        internal
        returns (uint256, uint256, uint256, uint256)
    {
        IKeeperExecutor.SyncPreview memory preview = _previewSync();
        uint256 routerUsdtOut = _fairRouterUsdtOut(preview);
        (IKeeperExecutor.KeeperIntent memory intent,) =
            _buildArbIntentWithTraits(routerUsdtOut, DonateMode.MIN_ONLY, 0, PayoutMode.WRAPPED, address(0));

        return _executeIntentReturns(intent, routerUsdtOut);
    }

}
