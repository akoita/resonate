// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RevertingReceiver
 * @notice Test helper that rejects native ETH while `reject` is true, used to verify
 *         that custody contracts escrow a failed payout (push-then-escrow) instead of
 *         reverting the whole operation (#1287). Toggle `reject` off to let it later
 *         claim the escrowed funds.
 */
contract RevertingReceiver {
    bool public reject = true;

    function setReject(bool r) external {
        reject = r;
    }

    receive() external payable {
        if (reject) revert("RevertingReceiver: rejected");
    }
}
