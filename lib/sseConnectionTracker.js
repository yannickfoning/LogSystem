// SSE Connection Tracker - Prevents connection spam by limiting concurrent connections per user

const activeSSEConnections = new Map(); // userId -> count

/**
 * Track a new SSE connection for a user
 * @param {number} userId - User ID
 * @returns {number} Current connection count for this user
 */
export function trackSSEConnection(userId) {
  const currentCount = activeSSEConnections.get(userId) || 0;
  activeSSEConnections.set(userId, currentCount + 1);
  return currentCount + 1;
}

/**
 * Untrack an SSE connection for a user
 * @param {number} userId - User ID
 */
export function untrackSSEConnection(userId) {
  const currentCount = activeSSEConnections.get(userId) || 0;
  if (currentCount <= 1) {
    activeSSEConnections.delete(userId);
  } else {
    activeSSEConnections.set(userId, currentCount - 1);
  }
}

/**
 * Get current connection count for a user
 * @param {number} userId - User ID
 * @returns {number} Current connection count
 */
export function getSSEConnectionCount(userId) {
  return activeSSEConnections.get(userId) || 0;
}

/**
 * Get total active SSE connections across all users
 * @returns {number} Total connection count
 */
export function getTotalSSEConnections() {
  let total = 0;
  for (const count of activeSSEConnections.values()) {
    total += count;
  }
  return total;
}
