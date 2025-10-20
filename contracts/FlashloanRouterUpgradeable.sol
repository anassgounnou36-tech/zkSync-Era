// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/**
 * @title FlashloanRouterUpgradeable
 * @notice UUPS upgradable flashloan router for zkSync Era arbitrage
 * @dev Provides generic flashloan interface with role-based access control
 */
contract FlashloanRouterUpgradeable is
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bool public paused;
    address public arbitrageExecutor;

    event FlashloanExecuted(
        address indexed token,
        uint256 amount,
        uint256 fee,
        address indexed executor
    );
    event PausedStateChanged(bool newState);
    event ArbitrageExecutorUpdated(address indexed newExecutor);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to receive admin role
     */
    function initialize(address admin) public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        
        paused = false;
    }

    /**
     * @notice Execute a flashloan operation
     * @param token Token to flashloan
     * @param amount Amount to borrow
     * @param data Encoded data for callback
     */
    function executeFlashloan(
        address token,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant onlyRole(EXECUTOR_ROLE) {
        require(!paused, "Contract is paused");
        require(arbitrageExecutor != address(0), "Arbitrage executor not set");
        require(amount > 0, "Amount must be greater than 0");

        // For mock implementation, we simulate flashloan by temporarily transferring tokens
        // In production, integrate with actual zkSync Era flashloan providers
        
        uint256 balanceBefore = IERC20Upgradeable(token).balanceOf(address(this));
        
        // Transfer tokens to executor (simulated loan)
        IERC20Upgradeable(token).safeTransfer(arbitrageExecutor, amount);

        // Execute arbitrage callback
        (bool success, ) = arbitrageExecutor.call(data);
        require(success, "Arbitrage execution failed");

        // Check repayment with fee (0.09% fee for mock)
        uint256 fee = (amount * 9) / 10000;
        uint256 balanceAfter = IERC20Upgradeable(token).balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Flashloan not repaid with fee");

        emit FlashloanExecuted(token, amount, fee, msg.sender);
    }

    /**
     * @notice Set the arbitrage executor contract
     * @param _executor Address of the arbitrage executor
     */
    function setArbitrageExecutor(address _executor) external onlyRole(ADMIN_ROLE) {
        require(_executor != address(0), "Invalid executor address");
        arbitrageExecutor = _executor;
        emit ArbitrageExecutorUpdated(_executor);
    }

    /**
     * @notice Pause or unpause the contract
     * @param _paused New paused state
     */
    function setPaused(bool _paused) external onlyRole(PAUSER_ROLE) {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    /**
     * @notice Withdraw tokens from the contract
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @param to Recipient address
     */
    function withdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyRole(ADMIN_ROLE) {
        require(to != address(0), "Invalid recipient");
        IERC20Upgradeable(token).safeTransfer(to, amount);
    }

    /**
     * @dev Function that should revert when msg.sender is not authorized to upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}
