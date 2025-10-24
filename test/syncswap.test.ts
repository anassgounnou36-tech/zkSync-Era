import { describe, it, expect, beforeEach } from "vitest";
import {
  getSyncSwapDiagnostics,
  resetSyncSwapState,
} from "../src/prices/adapters/syncswap.js";

describe("SyncSwap Quote Engine", () => {
  beforeEach(() => {
    // Reset state before each test
    resetSyncSwapState();
  });

  describe("State management", () => {
    it("should track disabled pairs", () => {
      const diag = getSyncSwapDiagnostics();
      
      expect(diag.errorCounters).toBeDefined();
      expect(diag.disabledPairs).toBeDefined();
      expect(diag.maxErrors).toBe(5);
    });

    it("should reset state correctly", () => {
      resetSyncSwapState();
      const diag = getSyncSwapDiagnostics();
      
      expect(diag.errorCounters.size).toBe(0);
      expect(diag.disabledPairs.size).toBe(0);
    });
  });
});
