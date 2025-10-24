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

  it("should use environment RPC when ZKSYNC_RPC_HTTP is set", () => {
    process.env.ZKSYNC_RPC_HTTP = "https://env-rpc.example.com";
    
    const urls = getSelectedRpcUrls();
    expect(urls.httpUrl).toBe("https://env-rpc.example.com");
  });

  it("should throw error when ZKSYNC_RPC_HTTP is not set", () => {
    delete process.env.ZKSYNC_RPC_HTTP;
    
    expect(() => getSelectedRpcUrls()).toThrow(
      "ZKSYNC_RPC_HTTP must be set in environment variables"
    );
  });

  it("should use environment RPC with both HTTP and WS", () => {
    process.env.ZKSYNC_RPC_HTTP = "https://env-preference.example.com";
    process.env.ZKSYNC_RPC_WS = "wss://env-ws.example.com";
    
    const urls = getSelectedRpcUrls();
    expect(urls.httpUrl).toBe("https://env-preference.example.com");
    expect(urls.wsUrl).toBe("wss://env-ws.example.com");
  });

  it("should require ZKSYNC_RPC_HTTP with clear error message", () => {
    delete process.env.ZKSYNC_RPC_HTTP;
    
    expect(() => getSelectedRpcUrls()).toThrow(/ZKSYNC_RPC_HTTP must be set/);
    expect(() => getSelectedRpcUrls()).toThrow(/No config fallback is supported/);
  });

  it("should create an instrumented provider", () => {
    process.env.ZKSYNC_RPC_HTTP = "https://test-rpc.example.com";
    
    const provider = createProvider();
    
    expect(provider).toBeDefined();
    expect(typeof provider.send).toBe("function");
  });

  it("should work with only HTTP URL when WS is not set", () => {
    process.env.ZKSYNC_RPC_HTTP = "https://env-rpc.example.com";
    delete process.env.ZKSYNC_RPC_WS;
    
    const urls = getSelectedRpcUrls();
    expect(urls.httpUrl).toBe("https://env-rpc.example.com");
    expect(urls.wsUrl).toBeUndefined();
  });
});
