import { describe, it, expect } from "vitest";
import { createServer } from "../src/api/server.js";
import { metricsTracker } from "../src/monitoring/metrics.js";

describe("API Server Metrics Endpoint", () => {
  it("should return metrics from /metrics endpoint", async () => {
    // Clear and add some test metrics
    metricsTracker.clear();
    metricsTracker.recordRequest({
      method: "eth_blockNumber",
      endpoint: "https://test.example.com/rpc",
      timestamp: Date.now(),
      duration: 100,
      success: true,
    });

    const server = await createServer();

    const response = await server.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    
    expect(body).toHaveProperty("rpc");
    expect(body.rpc.totalRequests).toBe(1);
    expect(body.rpc.successfulRequests).toBe(1);
    expect(body.rpc.failedRequests).toBe(0);
    expect(body.rpc.byMethod["eth_blockNumber"]).toBe(1);

    await server.close();
  });

  it("should return health check", async () => {
    const server = await createServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("timestamp");

    await server.close();
  });
});
