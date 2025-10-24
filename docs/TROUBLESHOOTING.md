# Troubleshooting

## SyncSwap Quote Issues

### Overview
SyncSwap pools on zkSync Era can have different implementations (Classic vs Stable) and may expose different quote ABIs. The bot includes a resilient SyncSwap adapter that:

1. **Discovers pools** via both Classic and Stable factories
2. **Probes multiple ABIs** safely with try/catch wrappers
3. **Falls back to off-chain math** using pool reserves for Classic pools when on-chain quote functions revert
4. **Auto-disables** SyncSwap quoting for a pair after 5 consecutive failures to prevent log spam

### How Probing Works

The SyncSwap adapter attempts the following sequence:

1. Query Classic Factory (`0xf2DAd89f2788a8CD54625C60b55cD3d2D0ACa7Cb`) for a pool
2. Query Stable Factory (`0x5b9f21d407F35b10CbfDDca17D5D84b129356ea3`) for a pool
3. Select appropriate pool (prefer Stable for USDC/USDT pairs, else Classic)
4. Try ABI A: `getAmountOut(uint256 amountIn, address tokenIn)`
5. Try ABI B: `getAmountOut(address tokenIn, address tokenOut, uint256 amountIn)`
6. For Classic pools only: Read reserves and fee, calculate quote off-chain using constant-product formula
7. For Stable pools: Skip if all on-chain methods fail (stable invariant math requires additional parameters)

### Why Some Pools Revert

- Pool contracts may not implement the expected quote functions
- Pool may have insufficient liquidity
- Pool state may have changed between discovery and quoting

### Auto-Disable Feature

After 5 consecutive failures for the same token pair, SyncSwap quoting is disabled for that pair for the process lifetime. This prevents:
- RPC dashboard pollution with error code 3
- Unnecessary network calls
- Log noise

The error counter resets on any successful quote.

### Diagnostics

Use the `diag quotes` command to test SyncSwap behavior:

```bash
# Test SyncSwap quotes with verbose output
npm run cli -- diag quotes --dex syncswap_v1 --syncswap-verbose

# Test specific pair
npm run cli -- diag quotes --pair USDC/USDT --syncswap-verbose

# Check if auto-disable triggered
npm run cli -- diag quotes --dex syncswap_v1
# Look for "disabled for this pair" messages
```

The verbose mode shows:
- Which factories were queried
- Which pools were found
- Which ABI methods were attempted
- Whether off-chain fallback was used
- Reasons for skipping a path

## Other Issues

- zksolc compilation issues: ensure @matterlabs plugins are installed and using Node 20.
- RPC rate limits: add fallback providers or private endpoints.
- Telegram not sending: verify TELEGRAM_BOT_TOKEN and chat ID.
- CI failures: run `npm run lint`, `npm run test`, and check slither output.
