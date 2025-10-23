/**
 * Simple in-memory metrics tracker for RPC requests
 */

export interface RpcMetric {
  method: string;
  endpoint: string;
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
}

export interface MetricsSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  byMethod: Record<string, number>;
  byEndpoint: Record<string, number>;
  avgDuration: number;
}

class MetricsTracker {
  private metrics: RpcMetric[] = [];
  private readonly maxMetrics = 10000; // Keep last 10k requests

  /**
   * Record a single RPC request metric
   */
  recordRequest(metric: RpcMetric): void {
    this.metrics.push(metric);

    // Keep only recent metrics to avoid memory issues
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  /**
   * Get summary of all metrics
   */
  getSummary(): MetricsSummary {
    const totalRequests = this.metrics.length;
    const successfulRequests = this.metrics.filter(m => m.success).length;
    const failedRequests = this.metrics.filter(m => !m.success).length;

    const byMethod: Record<string, number> = {};
    const byEndpoint: Record<string, number> = {};
    let totalDuration = 0;

    for (const metric of this.metrics) {
      byMethod[metric.method] = (byMethod[metric.method] || 0) + 1;
      byEndpoint[metric.endpoint] = (byEndpoint[metric.endpoint] || 0) + 1;
      totalDuration += metric.duration;
    }

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      byMethod,
      byEndpoint,
      avgDuration: totalRequests > 0 ? totalDuration / totalRequests : 0,
    };
  }

  /**
   * Get recent metrics
   */
  getRecentMetrics(count: number = 100): RpcMetric[] {
    return this.metrics.slice(-count);
  }

  /**
   * Get metrics for a specific endpoint
   */
  getMetricsByEndpoint(endpoint: string): RpcMetric[] {
    return this.metrics.filter(m => m.endpoint === endpoint);
  }

  /**
   * Get metrics for a specific method
   */
  getMetricsByMethod(method: string): RpcMetric[] {
    return this.metrics.filter(m => m.method === method);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Get total request count
   */
  getTotalRequests(): number {
    return this.metrics.length;
  }
}

// Singleton instance
export const metricsTracker = new MetricsTracker();
