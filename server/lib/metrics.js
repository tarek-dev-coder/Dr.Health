export const metrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  chatRequests: 0,
  chatFailures: 0,
  rateLimited: 0,
};

export function snapshotMetrics() {
  return {
    uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
    requests: {
      total: metrics.totalRequests,
      chat: metrics.chatRequests,
      chatFailures: metrics.chatFailures,
      rateLimited: metrics.rateLimited,
    },
  };
}
