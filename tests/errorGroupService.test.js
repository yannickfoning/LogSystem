import { describe, expect, it, vi } from 'vitest';
import { refreshErrorGroupsForImport } from '../services/errorGroupService.js';

describe('import error-group refresh', () => {
  it('recounts touched errors with one user-scoped database query', async () => {
    const query = vi.fn().mockResolvedValue([{ affectedRows: 2 }]);

    const refreshed = await refreshErrorGroupsForImport({ query }, 42, 'job-1', 7);

    expect(refreshed).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain('import_job_id = ?');
    expect(sql).toContain('INNER JOIN');
    expect(sql).toContain('user_id <=> ?');
    expect(sql).toContain('GROUP BY logs.fingerprint');
    expect(parameters).toEqual(['job-1', 42, 42, 7, 7, 7, 7]);
  });
});
