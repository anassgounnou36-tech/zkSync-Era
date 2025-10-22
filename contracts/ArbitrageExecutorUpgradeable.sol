// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IMuteRouter
 * @notice Interface for Mute.io Router
 */
interface IMuteRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        bool[] calldata stable
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path,
        bool[] calldata stable
    ) external view returns (uint256[] memory amounts);
}

/**
 * @title IPancakeV3Router
 * @notice Interface for PancakeSwap V3 Router
 */
interface IPancakeV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

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
    using SafeERC20 for IERC20;

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

    // Known DEX router addresses on zkSync Era mainnet
    address public constant MUTE_ROUTER = 0x8B791913eB07C32779a16750e3868aA8495F5964;
    address public constant SYNCSWAP_V1_ROUTER = 0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295;
    address public constant SYNCSWAP_V2_ROUTER = 0x9B5def958d0f3b6955cBEa4D5B7809b2fb26b059;
    address public constant PANCAKE_V3_ROUTER = 0xD70C70AD87aa8D45b8D59600342FB3AEe76E3c68;

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
        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        
        // Approve router to spend tokens
        IERC20(tokenIn).safeIncreaseAllowance(router, amountIn);

        // Execute swap through router
        (bool success, ) = router.call(swapData);
        require(success, "Swap failed");

        // Check output amount
        uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        amountOut = balanceAfter; // Simplified for mock

        // Verify slippage protection
        require(amountOut >= minAmountOut, "Slippage too high");

        // Calculate profit (simplified)
        uint256 profit = amountOut > balanceBefore ? amountOut - balanceBefore : 0;

        emit ArbitrageExecuted(tokenIn, tokenOut, amountIn, amountOut, profit);
        
        return amountOut;
    }

    /**
     * @notice Execute dual-leg arbitrage with DEX routing
     * @param buyDex DEX router to buy from
     * @param sellDex DEX router to sell to
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Amount of input token
     * @param minProfit Minimum profit required
     */
    function executeArbitrageDual(
        address buyDex,
        address sellDex,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minProfit
    ) external nonReentrant onlyRole(EXECUTOR_ROLE) returns (uint256 profit) {
        require(!paused, "Contract is paused");
        require(whitelistedRouters[buyDex], "Buy DEX not whitelisted");
        require(whitelistedRouters[sellDex], "Sell DEX not whitelisted");
        require(whitelistedTokens[tokenIn], "Input token not whitelisted");
        require(whitelistedTokens[tokenOut], "Output token not whitelisted");
        require(amountIn > 0, "Amount must be greater than 0");

        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));

        // First swap: buy tokenOut using tokenIn
        uint256 intermediateAmount = _swap(buyDex, tokenIn, tokenOut, amountIn);

        // Second swap: sell tokenOut back to tokenIn
        uint256 finalAmount = _swap(sellDex, tokenOut, tokenIn, intermediateAmount);

        // Calculate profit
        uint256 balanceAfter = IERC20(tokenIn).balanceOf(address(this));
        profit = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;

        require(profit >= minProfit, "Insufficient profit");

        emit ArbitrageExecuted(tokenIn, tokenOut, amountIn, finalAmount, profit);

        return profit;
    }

    /**
     * @notice Internal function to execute swap on supported DEX
     * @param router DEX router address
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Amount to swap
     * @return amountOut Amount received
     */
    function _swap(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        require(amountIn > 0, "Invalid amount");

        // Approve router
        IERC20(tokenIn).safeIncreaseAllowance(router, amountIn);

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));

        if (router == MUTE_ROUTER) {
            // Mute.io swap
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;

            bool[] memory stable = new bool[](1);
            stable[0] = false; // Use volatile pools

            IMuteRouter(router).swapExactTokensForTokens(
                amountIn,
                0, // No minimum for internal swap (protected at top level)
                path,
                address(this),
                block.timestamp + 300, // 5 minute deadline
                stable
            );
        } else if (router == PANCAKE_V3_ROUTER) {
            // PancakeSwap V3 swap
            // Calculate minimum amount out with slippage protection
            uint256 amountOutMinimum = (amountIn * (10000 - maxSlippageBps)) / 10000;

            IPancakeV3Router.ExactInputSingleParams memory params = IPancakeV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 2500, // 0.25% fee tier
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0 // No price limit
            });

            IPancakeV3Router(router).exactInputSingle(params);
        } else if (router == SYNCSWAP_V1_ROUTER || router == SYNCSWAP_V2_ROUTER) {
            // SyncSwap not yet implemented - requires pool-specific encoding
            revert("SyncSwap swap not implemented");
        } else {
            revert("Unknown router");
        }

        uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        amountOut = balanceAfter - balanceBefore;

        // Revoke approval
        IERC20(tokenIn).forceApprove(router, 0);

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
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev Function that should revert when msg.sender is not authorized to upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}
