# DEX-Scoped Token Aliasing Implementation

## Overview
This implementation adds DEX-scoped token aliasing to transparently handle native USDC vs bridged USDC.e across different DEXes, with automatic fallback when pools don't exist. It also enhances diagnostics to show which tokens were actually used in quotes.

## Problem Statement
Different DEXes on zkSync Era have varying liquidity for:
- **Native USDC** (0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4)
- **Bridged USDC.e** (0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4)

Previously, the bot would either:
1. Return tiny/nonsensical quotes when using native USDC on DEXes without native USDC pools
2. Miss opportunities on DEXes that only support USDC.e

## Solution: DEXTokenResolver

### Architecture
A new `DEXTokenResolver` class provides token aliasing logic that can be configured per-DEX:

```typescript
type AliasingPolicy = "auto" | "force-native" | "force-bridged" | "off";
```

### Aliasing Policies

#### 1. `auto` (Default)
- Try native USDC first
- If quote fails, automatically retry with USDC.e
- Never force invalid swaps
- Best for production

#### 2. `force-native`
- Always replace USDC.e with native USDC
- Fail if pool doesn't exist
- Useful for DEXes known to only support native

#### 3. `force-bridged`
- Always replace native USDC with USDC.e
- Fail if pool doesn't exist
- Useful for DEXes known to only support bridged

#### 4. `off`
- No aliasing, use addresses as-is
- Backward compatible mode

## Configuration

### Per-DEX Policy (`config/dexes.json`)
```json
{
  "dexes": {
    "mute": {
      "tokenAliasing": "auto"
    },
    "pancakeswap_v3": {
      "tokenAliasing": "auto"
    },
    "syncswap_v1": {
      "tokenAliasing": "auto",
      "routerV2": "0x9B5def958d0f3b6955cBEa4D5B7809b2fb26b059"
    }
  }
}
```

### Token Priority
```json
{
  "tokenPriority": {
    "USDC": ["USDC", "USDC.e"],
    "comment": "Prefer native USDC first, fall back to USDC.e"
  }
}
```

## Implementation Details

### 1. Mute.io Adapter
**Location:** `src/prices/fetcher.ts` - `fetchMutePrice()`

**Behavior with `auto` policy:**
1. Try quote with native USDC
2. If fails and pair involves USDC, retry with USDC.e
3. Add metadata showing which tokens were used

**Example:**
```typescript
// Input: USDC(native) / USDT
// First attempt: USDC(native) -> USDT (fails: no pool)
// Second attempt: USDC.e -> USDT (succeeds)
// Metadata: { tokenInFrom: "bridged" }
```

### 2. PancakeSwap V3 Adapter
**Location:** `src/prices/fetcher.ts` - `fetchPancakeSwapV3Price()`

**Enhancement:**
- Multi-hop intermediate tokens already include both USDC and USDC.e
- Automatically tries both in path enumeration
- Priority order: USDC (native), USDC.e (bridged), USDT
- Selects best path by amountOut

**Path Examples:**
```
WETH -> USDT
Direct paths:
  - WETH -> USDT (fee: 500)
  - WETH -> USDT (fee: 2500)

Multi-hop paths:
  - WETH -> USDC(native) -> USDT (fees: 500, 500)
  - WETH -> USDC(native) -> USDT (fees: 500, 2500)
  - WETH -> USDC(native) -> USDT (fees: 2500, 500)
  - WETH -> USDC(native) -> USDT (fees: 2500, 2500)
  - WETH -> USDC.e -> USDT (fees: 500, 500)
  - WETH -> USDC.e -> USDT (fees: 500, 2500)
  - WETH -> USDC.e -> USDT (fees: 2500, 500)
  - WETH -> USDC.e -> USDT (fees: 2500, 2500)
  - WETH -> USDT -> ... (all fee combinations)
```

### 3. SyncSwap Adapter
**Location:** `src/prices/adapters/syncswap.ts`

**Router V2 Integration (already implemented):**
- Stable pools use Router V2 `getAmountsOut(amountIn, path[], pools[])`
- Classic pools use direct pool methods or off-chain calculation
- Clean failure handling (no crashes)

## Diagnostics Enhancement

### Updated Output Format
**Location:** `src/cli/diag.ts` - `diagQuotes()`

**Before:**
```
✓ mute           : 1000.000000 USDT (1.000000 USDT per USDC) [pool: stable]
```

**After (with aliasing):**
```
✓ mute           : 1000.000000 USDT (1.000000 USDT per USDC) [pool: stable, tokens: USDC.e/USDT]
```

### Metadata Structure
```typescript
interface DexPrice {
  metadata?: {
    resolvedTokens?: {
      tokenInResolved?: string;    // Actual address used
      tokenOutResolved?: string;   // Actual address used
      tokenInFrom?: "native" | "bridged" | "original";
      tokenOutFrom?: "native" | "bridged" | "original";
    };
  };
}
```

## Testing

### Unit Tests
**File:** `test/tokenResolver.test.ts`
- 15 tests covering all resolver functionality
- Policy behavior validation
- Case insensitivity
- Token identification

### Integration Tests
**File:** `test/priceFetcher.test.ts`
- Mute stable pair detection
- Aliasing with native USDC
- Automatic fallback to USDC.e
- Metadata validation

**All tests pass:** 126 tests | 3 skipped

## Usage Examples

### Diagnostic Command
```bash
# Test quotes for USDC/USDT pair
npm run cli diag quotes --pair USDC/USDT --amount 2e9

# Expected output shows which tokens were actually used:
# ✓ mute: 2000.123456 USDT [tokens: USDC.e/USDT]
# ✓ syncswap_v1: 2000.234567 USDT [method: router-v2, pool: stable]
```

### Scan-Once Command
```bash
# Scan all pairs
npm run cli scan-once

# Output will show opportunities with proper token resolution
```

### Monitor Command
```bash
# Run continuous monitoring
npm run cli monitor --duration 1

# Aliasing happens automatically in background
```

## Impact

### Before Implementation
- Mute USDC(native)/USDT returned ~0 output
- PancakeSwap V3 WETH/USDT only tried direct paths
- SyncSwap stable quotes failed with "All quote methods failed"

### After Implementation
- Mute automatically uses USDC.e when native USDC pool doesn't exist
- PancakeSwap V3 enumerates multi-hop via both USDC and USDC.e
- SyncSwap stable pools use Router V2 successfully
- Diagnostics clearly show which tokens were used

## Safety & Compatibility

### Recognition-Only
- No executor modifications
- Only affects quote fetching
- All math remains BigInt
- Display shows signed spreads

### Backward Compatible
- Policy `off` disables aliasing completely
- Existing pairs continue to work
- No breaking changes to API

### Error Handling
- Failed quotes return proper error messages
- No crashes from missing pools
- Fallback attempts are logged

## Future Enhancements

### Potential Improvements
1. Add more intermediate tokens (DAI, WBTC) to PancakeSwap multi-hop
2. Implement pool liquidity checks before attempting quotes
3. Add caching for successful token resolutions
4. Support aliasing for other token pairs (not just USDC)

### Configuration Knobs
- Per-pair aliasing overrides
- Timeout configuration for path attempts
- Concurrency limits for parallel quotes

## Related Files

### Core Implementation
- `src/prices/tokenResolver.ts` - Main resolver class
- `src/prices/fetcher.ts` - DEX adapters with aliasing
- `src/prices/adapters/syncswap.ts` - SyncSwap Router V2

### Configuration
- `config/dexes.json` - DEX configs with aliasing policies

### Tests
- `test/tokenResolver.test.ts` - Unit tests
- `test/priceFetcher.test.ts` - Integration tests

### Documentation
- `DEX_TOKEN_ALIASING.md` - This file
- `IMPLEMENTATION_SUMMARY.md` - Previous implementation notes
