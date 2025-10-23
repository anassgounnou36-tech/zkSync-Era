import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createProvider, getSelectedRpcUrls } from "../src/providers/factory.js";

describe("Provider Factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it("should use runtime override when provided", () => {
    const customRpc = "https://custom-rpc.example.com";
    const urls = getSelectedRpcUrls(customRpc);
    
    expect(urls.httpUrl).toBe(customRpc);
  });

  it("should use environment RPC when USE_ENV_RPC_ONLY is true", () => {
    process.env.USE_ENV_RPC_ONLY = "true";
    process.env.ZKSYNC_RPC_HTTP = "https://env-rpc.example.com";
    
    const urls = getSelectedRpcUrls();
    expect(urls.httpUrl).toBe("https://env-rpc.example.com");
  });

  it("should throw error when USE_ENV_RPC_ONLY is true but ZKSYNC_RPC_HTTP is not set", () => {
    process.env.USE_ENV_RPC_ONLY = "true";
    delete process.env.ZKSYNC_RPC_HTTP;
    
    expect(() => getSelectedRpcUrls()).toThrow(
      "USE_ENV_RPC_ONLY is true but ZKSYNC_RPC_HTTP is not set"
    );
  });

  it("should prefer environment RPC over config when set", () => {
    process.env.USE_ENV_RPC_ONLY = "false";
    process.env.ZKSYNC_RPC_HTTP = "https://env-preference.example.com";
    
    const urls = getSelectedRpcUrls();
    expect(urls.httpUrl).toBe("https://env-preference.example.com");
  });

  it("should fall back to config when env variables are not set", () => {
    delete process.env.USE_ENV_RPC_ONLY;
    delete process.env.ZKSYNC_RPC_HTTP;
    delete process.env.ZKSYNC_ERA_RPC_URL;
    
    const urls = getSelectedRpcUrls();
    // Should use dexes.json fallback
    expect(urls.httpUrl).toBe("https://mainnet.era.zksync.io");
  });

  it("should create an instrumented provider", () => {
    const provider = createProvider();
    
    expect(provider).toBeDefined();
    expect(typeof provider.send).toBe("function");
  });

  it("should include WebSocket URL when available", () => {
    process.env.USE_ENV_RPC_ONLY = "true";
    process.env.ZKSYNC_RPC_HTTP = "https://env-rpc.example.com";
    process.env.ZKSYNC_RPC_WS = "wss://env-ws.example.com";
    
    const urls = getSelectedRpcUrls();
    expect(urls.httpUrl).toBe("https://env-rpc.example.com");
    expect(urls.wsUrl).toBe("wss://env-ws.example.com");
  });
});
