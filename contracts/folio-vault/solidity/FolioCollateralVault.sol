// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev HTS fungible tokens on Hedera expose ERC-20-style transfer / approve / transferFrom
/// (see Hedera docs: ERC-20 fungible tokens + HTS).
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title FolioCollateralVault
/// @notice Custodies portfolio (MOCK stock) HTS tokens via allowance + transferFrom; operator releases on repay/settlement.
contract FolioCollateralVault {
    address public operator;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Released(address indexed to, address indexed token, uint256 amount);

    error NotOperator();
    error ZeroAddress();
    error ZeroAmount();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    /// @notice Pull `amount` of `token` from msg.sender (user must have approved this vault).
    function deposit(address token, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Operator returns collateral to `to` (trusted operator, same model as server-side Folio flows).
    function release(address token, address to, uint256 amount) external onlyOperator {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        require(IERC20(token).transfer(to, amount), "transfer failed");
        emit Released(to, token, amount);
    }
}
