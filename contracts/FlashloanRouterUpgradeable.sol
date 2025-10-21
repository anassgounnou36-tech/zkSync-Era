// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ISyncSwapVault
 * @notice Interface for SyncSwap Vault flashloan functionality
 */
interface ISyncSwapVault {
    function flashLoan(
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external;
}

/**
 * @title IFlashloanCallback
 * @notice Interface for flashloan callback
 */
interface IFlashloanCallback {
    function receiveFlashLoan(
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata userData
    ) external;
}

/**
 * @title FlashloanRouterUpgradeable
 * @notice UUPS upgradable flashloan router for zkSync Era arbitrage
 * @dev Provides generic flashloan interface with role-based access control
 */
contract FlashloanRouterUpgradeable is
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    IFlashloanCallback
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bool public paused;
    address public arbitrageExecutor;
    address public syncSwapVault;

    event FlashloanExecuted(
        address indexed token,
        uint256 amount,
        uint256 fee,
        address indexed executor
    );
    event PausedStateChanged(bool newState);
    event ArbitrageExecutorUpdated(address indexed newExecutor);
    event SyncSwapVaultUpdated(address indexed newVault);

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
        syncSwapVault = 0x621425a1Ef6abE91058E9712575dcc4258F8d091;
    }

    /**
     * @notice Execute a flashloan operation using SyncSwap Vault (multi-token support)
     * @param tokens Array of token addresses to flashloan
     * @param amounts Array of amounts to borrow
     * @param data Encoded data for callback
     */
    function executeFlashloanMulti(
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata data
    ) external nonReentrant onlyRole(EXECUTOR_ROLE) {
        require(!paused, "Contract is paused");
        require(arbitrageExecutor != address(0), "Arbitrage executor not set");
        require(syncSwapVault != address(0), "SyncSwap vault not set");
        require(tokens.length == amounts.length, "Array length mismatch");
        require(tokens.length > 0, "Empty arrays");

        // Call SyncSwap Vault flashLoan
        ISyncSwapVault(syncSwapVault).flashLoan(
            address(this),
            tokens,
            amounts,
            data
        );
    }

    /**
     * @notice Callback function called by SyncSwap Vault
     * @param tokens Array of token addresses
     * @param amounts Array of borrowed amounts
     * @param feeAmounts Array of fee amounts (expected to be 0 for SyncSwap)
     * @param userData Encoded arbitrage execution data
     */
    function receiveFlashLoan(
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata userData
    ) external override nonReentrant {
        require(msg.sender == syncSwapVault, "Only SyncSwap Vault can call");
        require(arbitrageExecutor != address(0), "Arbitrage executor not set");

        // Transfer borrowed tokens to arbitrage executor
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).safeTransfer(arbitrageExecutor, amounts[i]);
        }

        // Execute arbitrage
        (bool success, ) = arbitrageExecutor.call(userData);
        require(success, "Arbitrage execution failed");

        // Repay flashloan with fees
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 repayAmount = amounts[i] + feeAmounts[i];
            IERC20(tokens[i]).safeTransferFrom(
                arbitrageExecutor,
                syncSwapVault,
                repayAmount
            );

            emit FlashloanExecuted(tokens[i], amounts[i], feeAmounts[i], msg.sender);
        }
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
        
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        
        // Transfer tokens to executor (simulated loan)
        IERC20(token).safeTransfer(arbitrageExecutor, amount);

        // Execute arbitrage callback
        (bool success, ) = arbitrageExecutor.call(data);
        require(success, "Arbitrage execution failed");

        // Check repayment with fee (0.09% fee for mock)
        uint256 fee = (amount * 9) / 10000;
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
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
     * @notice Set the SyncSwap Vault contract
     * @param _vault Address of the SyncSwap Vault
     */
    function setSyncSwapVault(address _vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_vault != address(0), "Invalid vault address");
        syncSwapVault = _vault;
        emit SyncSwapVaultUpdated(_vault);
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
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev Function that should revert when msg.sender is not authorized to upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}
