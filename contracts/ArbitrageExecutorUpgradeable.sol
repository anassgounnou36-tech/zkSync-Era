// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/**
 * @title ArbitrageExecutorUpgradeable
 * @notice UUPS upgradable arbitrage executor with whitelist and slippage protection
 * @dev Executes multi-hop swaps with safety checks
 */
contract ArbitrageExecutorUpgradeable is
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");

    bool public paused;
    uint256 public maxSlippageBps; // Max slippage in basis points (1 bps = 0.01%)
    
    mapping(address => bool) public whitelistedRouters;
    mapping(address => bool) public whitelistedTokens;

    event ArbitrageExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit
    );
    event RouterWhitelisted(address indexed router, bool status);
    event TokenWhitelisted(address indexed token, bool status);
    event MaxSlippageUpdated(uint256 newSlippage);
    event PausedStateChanged(bool newState);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to receive admin role
     * @param _maxSlippageBps Initial max slippage in basis points
     */
    function initialize(address admin, uint256 _maxSlippageBps) public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(WITHDRAWER_ROLE, admin);
        
        maxSlippageBps = _maxSlippageBps;
        paused = false;
    }

    /**
     * @notice Execute arbitrage trade
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Amount of input token
     * @param minAmountOut Minimum amount of output token (slippage protection)
     * @param router Router contract to use
     * @param swapData Encoded swap data
     */
    function executeArbitrage(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address router,
        bytes calldata swapData
    ) external nonReentrant onlyRole(EXECUTOR_ROLE) returns (uint256 amountOut) {
        require(!paused, "Contract is paused");
        require(whitelistedRouters[router], "Router not whitelisted");
        require(whitelistedTokens[tokenIn], "Input token not whitelisted");
        require(whitelistedTokens[tokenOut], "Output token not whitelisted");
        require(amountIn > 0, "Amount must be greater than 0");

        // Transfer input tokens from caller
        uint256 balanceBefore = IERC20Upgradeable(tokenIn).balanceOf(address(this));
        
        // Approve router to spend tokens
        IERC20Upgradeable(tokenIn).safeIncreaseAllowance(router, amountIn);

        // Execute swap through router
        (bool success, ) = router.call(swapData);
        require(success, "Swap failed");

        // Check output amount
        uint256 balanceAfter = IERC20Upgradeable(tokenOut).balanceOf(address(this));
        amountOut = balanceAfter; // Simplified for mock

        // Verify slippage protection
        require(amountOut >= minAmountOut, "Slippage too high");

        // Calculate profit (simplified)
        uint256 profit = amountOut > balanceBefore ? amountOut - balanceBefore : 0;

        emit ArbitrageExecuted(tokenIn, tokenOut, amountIn, amountOut, profit);
        
        return amountOut;
    }

    /**
     * @notice Whitelist or delist a router
     * @param router Router address
     * @param status Whitelist status
     */
    function setRouterWhitelist(address router, bool status) external onlyRole(STRATEGIST_ROLE) {
        require(router != address(0), "Invalid router address");
        whitelistedRouters[router] = status;
        emit RouterWhitelisted(router, status);
    }

    /**
     * @notice Whitelist or delist a token
     * @param token Token address
     * @param status Whitelist status
     */
    function setTokenWhitelist(address token, bool status) external onlyRole(STRATEGIST_ROLE) {
        require(token != address(0), "Invalid token address");
        whitelistedTokens[token] = status;
        emit TokenWhitelisted(token, status);
    }

    /**
     * @notice Update max slippage
     * @param _maxSlippageBps New max slippage in basis points
     */
    function setMaxSlippage(uint256 _maxSlippageBps) external onlyRole(STRATEGIST_ROLE) {
        require(_maxSlippageBps <= 1000, "Slippage too high"); // Max 10%
        maxSlippageBps = _maxSlippageBps;
        emit MaxSlippageUpdated(_maxSlippageBps);
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
    ) external onlyRole(WITHDRAWER_ROLE) {
        require(to != address(0), "Invalid recipient");
        IERC20Upgradeable(token).safeTransfer(to, amount);
    }

    /**
     * @dev Function that should revert when msg.sender is not authorized to upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}
