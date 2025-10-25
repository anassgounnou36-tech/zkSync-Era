# Testing Guide for Native USDC Implementation

This guide outlines how to test the native USDC and enhanced recognition features.

## Prerequisites

1. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your RPC URL and private key
   ```

2. Build the project:
   ```bash
   npm install
   npm run build
   ```

## Unit Tests

All unit tests pass without live RPC:
```bash
npm test
```

Expected: 109 tests passing, 3 skipped

## Configuration Verification

Verify native USDC and expanded pairs are configured:
```bash
npm run cli -- diag config
```

Expected output:
- USDC: 0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4 (native)
- USDC.e: 0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4 (bridged)
- 6 target pairs including USDC/USDC.e

## Live Testing (requires RPC access)

### Test 1: PancakeSwap V3 Multi-Hop Paths

Test that PancakeSwap V3 enumerates paths and selects the best:
```bash
npm run cli -- diag quotes --pair WETH/USDT --amount-human "1 WETH"
```

Expected:
- Shows direct paths at fee tiers 500 and 2500
- Shows multi-hop via USDC (native) at various fee combinations
- Shows multi-hop via USDC.e (fallback) at various fee combinations
- Shows multi-hop via USDT where relevant
- Logs which path was selected and the fee tiers used
- Path statistics showing successful/failed/timeout counts

### Test 2: SyncSwap Stable Pool Quotes

Test that SyncSwap uses Router V2 for stable pools:
```bash
npm run cli -- diag quotes --pair USDC/USDT --amount-human "2000 USDC" --syncswap-verbose
```

Expected:
- Shows SyncSwap V1 quote using Router V2 getAmountsOut
- Verbose logs show "Attempting Router V2 getAmountsOut for Stable pool"
- If pool doesn't exist, cleanly skips with reason (no crash)
- Method shows "router-v2" in metadata

### Test 3: scan-once with --amount-human

Test that sizing fallback works correctly:
```bash
npm run cli -- scan-once --amount-human "1 WETH"
```

Expected:
- Uses 1 WETH for WETH-base pairs
- Uses configured defaults for non-WETH-base pairs (e.g., USDC/USDT)
- Warning logged: "For pairs where WETH is NOT the base token, the configured default size will be used instead"
- All 6 pairs are enumerated
- No pairs skipped due to 0-size

### Test 4: monitor --recognize-all

Test that monitor runs without DB migration errors:
```bash
npm run cli -- monitor --duration 0.05 --recognize-all
```

Expected:
- Monitor starts successfully
- "Database schema initialized with migrations" logged
- No "no such column" errors
- When spreads > 0, rows appear with recognized=1
- Runs for 0.05 hours (3 minutes) and generates report

## Verification Checklist

- [ ] All unit tests pass (109 passing)
- [ ] Config shows native USDC at correct address
- [ ] Config shows all 6 target pairs
- [ ] PancakeSwap quotes show multi-hop paths attempted
- [ ] PancakeSwap logs show best path selection
- [ ] SyncSwap stable pairs use Router V2 getAmountsOut
- [ ] SyncSwap stable failures are clean (no crash)
- [ ] scan-once with --amount-human uses correct defaults
- [ ] scan-once doesn't skip pairs due to 0-size
- [ ] monitor starts without DB errors
- [ ] monitor recognizes opportunities when spreads > 0

## Notes

- All changes are recognition-only (no execution)
- All math remains BigInt (display only shows formatted values)
- Gas reporting uses 1.2x safety multiplier (display only)
- No gating on gas for recognition
