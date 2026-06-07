// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Test} from "forge-std/src/Test.sol";

import {KeepersTreasury} from "src/core/KeepersTreasury.sol";
import {IKeepersTreasury} from "src/interfaces/IKeepersTreasury.sol";
import {PoolConfigLib} from "src/libs/PoolConfigLib.sol";
import {PoolConfig} from "src/types/PoolConfigTypes.sol";

contract MockFeeToken is ERC20 {

    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

}

contract KeepersTreasury_FeeSplit_Test is Test {

    bytes32 internal constant POOL_ID = keccak256("pool");
    address internal constant HOOK = address(0x512C);
    address internal constant SYNC = address(0x511C);
    address internal constant FEED = address(0xFEED);

    KeepersTreasury internal treasury;
    MockFeeToken internal token;

    uint16 internal lpBps;
    uint16 internal syncBps;
    uint16 internal feedBps;

    function setUp() public {
        treasury = new KeepersTreasury(address(this));
        treasury.setHook(HOOK, true);
        token = new MockFeeToken();

        PoolConfig memory cfg = PoolConfigLib.defaultConfig();
        lpBps = cfg.lpShareBps;
        syncBps = cfg.syncShareBps;
        feedBps = cfg.feedShareBps;
    }

    function test_accrueSwapFee_redirectsFeedShareToLpWhenNoFeedKeeper() public {
        uint256 totalFee = 10_000;
        uint256 keeperTotal = _syncAmount(totalFee);

        _fundHook(keeperTotal);

        vm.expectEmit(true, true, true, true);
        emit IKeepersTreasury.FeeAccrued(
            POOL_ID,
            address(token),
            totalFee,
            _lpAmount(totalFee) + _feedAmount(totalFee),
            _syncAmount(totalFee),
            0,
            SYNC,
            address(0)
        );

        vm.prank(HOOK);
        treasury.accrueSwapFee(
            POOL_ID, address(token), totalFee, address(0), SYNC, lpBps, syncBps, feedBps
        );

        assertEq(treasury.claimable(SYNC, address(token)), _syncAmount(totalFee));
        assertEq(treasury.claimable(FEED, address(token)), 0);
        assertEq(token.balanceOf(address(treasury)), keeperTotal);
    }

    function test_accrueSwapFee_redirectsSyncShareToLpWhenNoSyncKeeper() public {
        uint256 totalFee = 10_000;
        uint256 keeperTotal = _feedAmount(totalFee);

        _fundHook(keeperTotal);

        vm.expectEmit(true, true, true, true);
        emit IKeepersTreasury.FeeAccrued(
            POOL_ID,
            address(token),
            totalFee,
            _lpAmount(totalFee) + _syncAmount(totalFee),
            0,
            _feedAmount(totalFee),
            address(0),
            FEED
        );

        vm.prank(HOOK);
        treasury.accrueSwapFee(
            POOL_ID, address(token), totalFee, FEED, address(0), lpBps, syncBps, feedBps
        );

        assertEq(treasury.claimable(FEED, address(token)), _feedAmount(totalFee));
        assertEq(treasury.claimable(SYNC, address(token)), 0);
        assertEq(token.balanceOf(address(treasury)), keeperTotal);
    }

    function test_accrueSwapFee_splitsWhenBothKeepersPresent() public {
        uint256 totalFee = 10_000;
        uint256 keeperTotal = _syncAmount(totalFee) + _feedAmount(totalFee);

        _fundHook(keeperTotal);

        vm.expectEmit(true, true, true, true);
        emit IKeepersTreasury.FeeAccrued(
            POOL_ID,
            address(token),
            totalFee,
            _lpAmount(totalFee),
            _syncAmount(totalFee),
            _feedAmount(totalFee),
            SYNC,
            FEED
        );

        vm.prank(HOOK);
        treasury.accrueSwapFee(
            POOL_ID, address(token), totalFee, FEED, SYNC, lpBps, syncBps, feedBps
        );

        assertEq(treasury.claimable(SYNC, address(token)), _syncAmount(totalFee));
        assertEq(treasury.claimable(FEED, address(token)), _feedAmount(totalFee));
        assertEq(token.balanceOf(address(treasury)), keeperTotal);
    }

    function test_accrueSwapFee_noTransferWhenNoActiveKeepers() public {
        uint256 totalFee = 10_000;

        vm.expectEmit(true, true, true, true);
        emit IKeepersTreasury.FeeAccrued(
            POOL_ID, address(token), totalFee, totalFee, 0, 0, address(0), address(0)
        );

        vm.prank(HOOK);
        treasury.accrueSwapFee(
            POOL_ID, address(token), totalFee, address(0), address(0), lpBps, syncBps, feedBps
        );

        assertEq(token.balanceOf(address(treasury)), 0);
    }

    function _fundHook(uint256 amount) private {
        token.mint(HOOK, amount);
        vm.prank(HOOK);
        token.approve(address(treasury), amount);
    }

    function _lpAmount(uint256 totalFee) private view returns (uint256) {
        return (totalFee * lpBps) / PoolConfigLib.BPS;
    }

    function _syncAmount(uint256 totalFee) private view returns (uint256) {
        return (totalFee * syncBps) / PoolConfigLib.BPS;
    }

    function _feedAmount(uint256 totalFee) private view returns (uint256) {
        return (totalFee * feedBps) / PoolConfigLib.BPS;
    }

}
