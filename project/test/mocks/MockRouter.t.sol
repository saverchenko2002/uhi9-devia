// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockRouter {

    using SafeERC20 for IERC20;

    function packSwapCalldata(
        address inputToken,
        uint256 inputAmount,
        address profitToken,
        uint256 profitAmount
    ) external view returns (bytes memory) {
        return abi.encodePacked(
            address(this),
            abi.encodeCall(
                MockRouter.simulateArb, (inputToken, inputAmount, profitToken, profitAmount)
            )
        );
    }

    function simulateArb(
        address inputToken,
        uint256 inputAmount,
        address profitToken,
        uint256 profitAmount
    ) external {
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);
        IERC20(profitToken).safeTransfer(msg.sender, profitAmount);
    }

    receive() external payable {}

}
