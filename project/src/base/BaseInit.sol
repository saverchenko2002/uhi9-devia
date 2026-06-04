// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

abstract contract BaseInit is Ownable {

    event Initialized(address indexed owner, uint256 atBlock);

    error AddressZero();

    modifier nonZeroAddress(address addr) {
        if (addr == address(0)) revert AddressZero();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {
        emit Initialized(initialOwner, block.number);
    }

}
