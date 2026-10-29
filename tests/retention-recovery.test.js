import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pool: { getConnection: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  invalidateAllDashboards: vi.fn(),
  invalidateDashboard: vi.fn()
}));

vi.mock('../config/database.js', () => ({ default: mocks.pool }));
vi.mock('../config/logger.js', () => ({ default: mocks.logger }));
vi.mock('../services/cacheService.js', () => ({
  invalidateAllDashboards: mocks.invalidateAllDashboards,
  invalidateDashboard: mocks.invalidateDashboard
}));

function makeConnection() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue([{ affectedRows: 0 }, []]),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    destroy: vi.fn()
  };
}

describe('retention recovery', () => {
  let retention;
  let originalCronHour;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    vi.clearAllMocks();
    vi.resetModules();
    originalCronHour = process.env.RETENTION_CRON_HOUR;
    process.env.RETENTION_CRON_HOUR = '3';
    retention = await import('../services/retentionService.js');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    if (originalCronHour === undefined) delete process.env.RETENTION_CRON_HOUR;
    else process.env.RETENTION_CRON_HOUR = originalCronHour;
  });

  it('retries a transient closed-connection failure with a fresh connection', async () => {
    const brokenConnection = makeConnection();
    const workingConnection = makeConnection();
    const closedConnectionError = new Error("Can't add new command when connection is in closed state");
    brokenConnection.execute.mockRejectedValueOnce(closedConnectionError);
    brokenConnection.rollback.mockRejectedValueOnce(closedConnectionError);
    mocks.pool.getConnection
      .mockResolvedValueOnce(brokenConnection)
      .mockResolvedValueOnce(workingConnection);

    const run = retention.runRetention();
    await vi.runAllTimersAsync();

    await expect(run).resolves.toHaveProperty('DEBUG');
    expect(mocks.pool.getConnection).toHaveBeenCalledTimes(2);
    expect(brokenConnection.destroy).toHaveBeenCalledOnce();
    expect(brokenConnection.release).not.toHaveBeenCalled();
    expect(workingConnection.commit).toHaveBeenCalledOnce();
    expect(workingConnection.release).toHaveBeenCalledOnce();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'retention_rollback_failed' }),
      '[RETENTION]'
    );
  });

  it('does not retry non-transient SQL errors', async () => {
    const connection = makeConnection();
    const sqlError = Object.assign(new Error('invalid SQL'), { code: 'ER_PARSE_ERROR' });
    connection.execute.mockRejectedValueOnce(sqlError);
    mocks.pool.getConnection.mockResolvedValueOnce(connection);

    await expect(retention.runRetention()).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' });
    expect(mocks.pool.getConnection).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('retries a failed scheduled run before waiting for the next day', async () => {
    const transientError = Object.assign(new Error('Connection lost: server closed the connection'), {
      code: 'PROTOCOL_CONNECTION_LOST'
    });
    mocks.pool.getConnection
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(makeConnection());

    retention.startRetentionScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 3000);

    expect(mocks.pool.getConnection).toHaveBeenCalledTimes(4);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'retention_completed' }),
      '[RETENTION]'
    );
    expect(mocks.logger.error).toHaveBeenCalledOnce();
  });
});
