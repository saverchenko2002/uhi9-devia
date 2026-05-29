// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import '@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract BaseUpgradeable is Ownable2StepUpgradeable, UUPSUpgradeable {

    event Initialized(address indexed executor, uint256 at);

    error AddressZero();

    modifier nonZeroAddress(address _address) {
        require(_address != address(0), AddressZero());
        _;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function renounceOwnership() public override onlyOwner {}

    function __Base_init() internal onlyInitializing {
        __Ownable_init(msg.sender);

        emit Initialized(msg.sender, block.number);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#storage-gaps
     */
    uint256[50] private __gap;

}
