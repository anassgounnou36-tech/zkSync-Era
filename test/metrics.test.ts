import { describe, it, expect, beforeEach } from "vitest";
import { metricsTracker } from "../src/monitoring/metrics.js";

describe("RPC Metrics Tracking", () => {
  beforeEach(() => {
    // Clear metrics before each test
    metricsTracker.clear();
  });

  it("should track successful RPC requests", () => {
    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 100,
      success: true,
    });

    const summary = metricsTracker.getSummary();
    expect(summary.totalRequests).toBe(1);
    expect(summary.successfulRequests).toBe(1);
    expect(summary.failedRequests).toBe(0);
    expect(summary.byMethod["eth_blockNumber"]).toBe(1);
  });

  it("should track failed RPC requests", () => {
    metricsTracker.recordRequest({
      method: "eth_call",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 50,
      success: false,
      error: "Network error",
    });

    const summary = metricsTracker.getSummary();
    expect(summary.totalRequests).toBe(1);
    expect(summary.successfulRequests).toBe(0);
    expect(summary.failedRequests).toBe(1);
  });

  it("should aggregate metrics by method", () => {
    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 100,
      success: true,
    });

    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 120,
      success: true,
    });

    metricsTracker.recordRequest({
      method: "eth_call",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 200,
      success: true,
    });

    const summary = metricsTracker.getSummary();
    expect(summary.totalRequests).toBe(3);
    expect(summary.byMethod["eth_blockNumber"]).toBe(2);
    expect(summary.byMethod["eth_call"]).toBe(1);
  });

  it("should aggregate metrics by endpoint", () => {
    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://endpoint1.com/rpc",
      timestamp: Date.now(),
      duration: 100,
      success: true,
    });

    metricsTracker.recordRequest({
      method: "eth_call",
      endpoint: "https://endpoint2.com/rpc",
      timestamp: Date.now(),
      duration: 150,
      success: true,
    });

    const summary = metricsTracker.getSummary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.byEndpoint["https://endpoint1.com/rpc"]).toBe(1);
    expect(summary.byEndpoint["https://endpoint2.com/rpc"]).toBe(1);
  });

  it("should calculate average duration", () => {
    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 100,
      success: true,
    });

    metricsTracker.recordRequest({
      method: "eth_call",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 200,
      success: true,
    });

    const summary = metricsTracker.getSummary();
    expect(summary.avgDuration).toBe(150);
  });

  it("should get recent metrics", () => {
    for (let i = 0; i < 150; i++) {
      metricsTracker.recordRequest({
        method: "eth_blockNumber",
        endpoint: "https://example.com/rpc",
        timestamp: Date.now() + i,
        duration: 100,
        success: true,
      });
    }

    const recent = metricsTracker.getRecentMetrics(50);
    expect(recent.length).toBe(50);
  });

  it("should filter metrics by method", () => {
    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 100,
      success: true,
    });

    metricsTracker.recordRequest({
      method: "eth_call",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 150,
      success: true,
    });

    const blockNumberMetrics = metricsTracker.getMetricsByMethod("eth_blockNumber");
    expect(blockNumberMetrics.length).toBe(1);
    expect(blockNumberMetrics[0].method).toBe("eth_blockNumber");
  });

  it("should clear all metrics", () => {
    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://example.com/rpc",
      timestamp: Date.now(),
      duration: 100,
      success: true,
    });

    expect(metricsTracker.getTotalRequests()).toBe(1);

    metricsTracker.clear();
    expect(metricsTracker.getTotalRequests()).toBe(0);
  });
});
