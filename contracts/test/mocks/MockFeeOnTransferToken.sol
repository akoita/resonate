// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockFeeOnTransferToken
 * @notice ERC20 that burns a basis-point fee on every transfer, so the recipient
 *         receives less than the sent amount. Used to verify that custody contracts
 *         reject fee-on-transfer / deflationary tokens instead of corrupting their
 *         per-token accounting (#1285). Mint/burn are fee-exempt.
 */
contract MockFeeOnTransferToken is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 _feeBps) ERC20("FeeToken", "FEE") {
        feeBps = _feeBps;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0), fee); // burn the fee
            super._update(from, to, value - fee); // recipient receives the remainder
        } else {
            super._update(from, to, value);
        }
    }
}
