import { query, execute } from './sql-db';

function generateCuid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export const db = {
  $queryRaw: async <T = any>(sql: string): Promise<T> => {
    return await query(sql) as T;
  },
  $executeRaw: async <T = any>(sql: string, params?: any[]): Promise<T> => {
    return await execute(sql, params) as T;
  },
  user: {
    findMany: async (where?: any) => {
      let sql = 'SELECT * FROM users';
      const params: any[] = [];
      if (where?.role) { sql += ' WHERE role = ?'; params.push(where.role); }
      if (where?.isActive !== undefined) { sql += ' WHERE isActive = ?'; params.push(where.isActive); }
      return await query(sql, params);
    },
    findFirst: async (where: any) => {
      const users = await db.user.findMany(where);
      return users[0] || null;
    },
    findUnique: async (where: any) => {
      if (where.id) { const rows = await query('SELECT * FROM users WHERE id = ?', [where.id]); return rows[0]; }
      if (where.email) { const rows = await query('SELECT * FROM users WHERE email = ?', [where.email]); return rows[0]; }
      return null;
    },
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO users (id, email, passwordHash, displayName, role, sessionVersion, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [id, data.email, data.passwordHash, data.displayName, data.role, 0]);
      return await db.user.findUnique({ where: { id } });
    },
    update: async (args: any) => {
      const { where, data } = args;
      const updates: string[] = [];
      const params: any[] = [];
      if (data.passwordHash) { updates.push('passwordHash = ?'); params.push(data.passwordHash); }
      if (data.sessionVersion !== undefined) { updates.push('sessionVersion = ?'); params.push(data.sessionVersion); }
      updates.push('updatedAt = NOW()');
      let sql = 'UPDATE users SET ' + updates.join(', ');
      if (where.id) { sql += ' WHERE id = ?'; params.push(where.id); }
      if (where.email) { sql += ' WHERE email = ?'; params.push(where.email); }
      await execute(sql, params);
      return await db.user.findUnique(where);
    },
    delete: async (where: any) => {
      let sql = 'DELETE FROM users';
      const params: any[] = [];
      if (where.id) { sql += ' WHERE id = ?'; params.push(where.id); }
      await execute(sql, params);
    },
    deleteMany: async (where?: any) => {
      let sql = 'DELETE FROM users';
      const params: any[] = [];
      if (where?.role) { sql += ' WHERE role = ?'; params.push(where.role); }
      const result = await execute(sql, params);
      return { count: result.affectedRows || 0 };
    },
    count: async () => {
      const rows = await query('SELECT COUNT(*) as count FROM users');
      return rows[0]?.count || 0;
    }
  },
  log: {
    findMany: async (args?: any) => {
      let sql = 'SELECT * FROM logs';
      const params: any[] = [];
      const conditions: string[] = [];
      if (args?.where?.userId) { conditions.push('userId = ?'); params.push(args.where.userId); }
      if (args?.where?.logLevel) { conditions.push('logLevel = ?'); params.push(args.where.logLevel); }
      if (args?.where?.timestamp?.gte) { conditions.push('timestamp >= ?'); params.push(args.where.timestamp.gte); }
      if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
      if (args?.orderBy) sql += ' ORDER BY timestamp DESC';
      if (args?.take) {
        const takeVal = parseInt(args.take, 10) || 50;
        sql += ' LIMIT ' + takeVal;
      }
      return await query(sql, params);
    },
    findFirst: async (where: any) => {
      const logs = await db.log.findMany({ where, take: 1 });
      return logs[0] || null;
    },
    findUnique: async (where: any) => {
      if (where.id) { const rows = await query('SELECT * FROM logs WHERE id = ?', [where.id]); return rows[0]; }
      return null;
    },
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO logs (id, timestamp, logLevel, message, userId, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
        [id, data.timestamp, data.logLevel, data.message, data.userId]);
      return await db.log.findUnique({ where: { id } });
    },
    createMany: async (args: any) => {
      const { data } = args;
      if (!data?.length) return { count: 0 };
      for (const log of data) {
        await db.log.create(log);
      }
      return { count: data.length };
    },
    deleteMany: async (where?: any) => {
      let sql = 'DELETE FROM logs';
      const params: any[] = [];
      if (where?.logLevel) { sql += ' WHERE logLevel = ?'; params.push(where.logLevel); }
      if (where?.timestamp?.lt) { sql += ' WHERE timestamp < ?'; params.push(where.timestamp.lt); }
      const result = await execute(sql, params);
      return { count: result.affectedRows || 0 };
    },
    delete: async (where: any) => {
      let sql = 'DELETE FROM logs';
      const params: any[] = [];
      if (where.id) { sql += ' WHERE id = ?'; params.push(where.id); }
      await execute(sql, params);
    },
    count: async (where?: any) => {
      let sql = 'SELECT COUNT(*) as count FROM logs';
      const params: any[] = [];
      if (where?.userId) { sql += ' WHERE userId = ?'; params.push(where.userId); }
      if (where?.logLevel) { sql += ' WHERE logLevel = ?'; params.push(where.logLevel); }
      if (where?.timestamp?.gte) { sql += ' WHERE timestamp >= ?'; params.push(where.timestamp.gte); }
      const rows = await query(sql, params);
      return rows[0]?.count || 0;
    },
    groupBy: async (args: any) => {
      const { by, where } = args;
      const field = by[0];
      // Validate field to prevent SQL injection
      const allowedFields = ['logLevel', 'source', 'sourceServer', 'service', 'errorType', 'eventType'];
      if (!allowedFields.includes(field)) {
        throw new Error('Invalid field for groupBy');
      }
      let sql = 'SELECT ' + field + ', COUNT(*) as _count FROM logs';
      const params: any[] = [];
      
      if (where) {
        const conditions: string[] = [];
        if (where.userId) {
          conditions.push('userId = ?');
          params.push(where.userId);
        }
        if (where.timestamp?.gte) {
          conditions.push('timestamp >= ?');
          params.push(where.timestamp.gte);
        }
        if (conditions.length > 0) {
          sql += ' WHERE ' + conditions.join(' AND ');
        }
      }
      
      sql += ' GROUP BY ' + field;
      
      const rows = await query(sql, params);
      return rows.map((row: any) => ({
        [field]: row[field],
        _count: { [field]: row._count }
      }));
    }
  },
  alert: {
    findMany: async (args?: any) => {
      let sql = 'SELECT * FROM alerts';
      const params: any[] = [];
      if (args?.where?.userId) { sql += ' WHERE userId = ?'; params.push(args.where.userId); }
      if (args?.where?.status) { sql += ' WHERE status = ?'; params.push(args.where.status); }
      if (args?.where?.ruleId) { sql += ' WHERE ruleId = ?'; params.push(args.where.ruleId); }
      if (args?.orderBy) sql += ' ORDER BY createdAt DESC';
      if (args?.take) {
        const takeVal = parseInt(args.take, 10) || 50;
        sql += ' LIMIT ' + takeVal;
      }
      return await query(sql, params);
    },
    findFirst: async (where: any) => {
      const alerts = await db.alert.findMany({ where, take: 1 });
      return alerts[0] || null;
    },
    findUnique: async (where: any) => {
      if (where.id) { const rows = await query('SELECT * FROM alerts WHERE id = ?', [where.id]); return rows[0]; }
      return null;
    },
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO alerts (id, alertType, severity, message, status, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [id, data.alertType, data.severity, data.message, data.status, data.userId]);
      return await db.alert.findUnique({ where: { id } });
    },
    update: async (args: any) => {
      const { where, data } = args;
      const updates: string[] = [];
      const params: any[] = [];
      if (data.readAt) { updates.push('readAt = ?'); params.push(data.readAt); }
      if (data.status) { updates.push('status = ?'); params.push(data.status); }
      let sql = 'UPDATE alerts SET ' + updates.join(', ');
      if (where.id) { sql += ' WHERE id = ?'; params.push(where.id); }
      await execute(sql, params);
      return await db.alert.findUnique(where);
    },
    updateMany: async (args: any) => {
      const { where, data } = args;
      const updates: string[] = [];
      const params: any[] = [];
      if (data.readAt) { updates.push('readAt = ?'); params.push(data.readAt); }
      if (data.status) { updates.push('status = ?'); params.push(data.status); }
      let sql = 'UPDATE alerts SET ' + updates.join(', ');
      const conditions: string[] = [];
      if (where?.userId) { conditions.push('userId = ?'); params.push(where.userId); }
      if (where?.readAt === null) { conditions.push('readAt IS NULL'); }
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      const result = await execute(sql, params);
      return { count: result.affectedRows || 0 };
    },
    delete: async (where: any) => {
      await execute('DELETE FROM alerts WHERE id = ?', [where.id]);
    },
    deleteMany: async (where?: any) => {
      let sql = 'DELETE FROM alerts';
      const params: any[] = [];
      if (where?.ruleId) { sql += ' WHERE ruleId = ?'; params.push(where.ruleId); }
      if (where?.userId) { sql += ' WHERE userId = ?'; params.push(where.userId); }
      const result = await execute(sql, params);
      return { count: result.affectedRows || 0 };
    },
    count: async (where?: any) => {
      let sql = 'SELECT COUNT(*) as count FROM alerts';
      const params: any[] = [];
      if (where?.userId) { sql += ' WHERE userId = ?'; params.push(where.userId); }
      if (where?.status) { sql += ' WHERE status = ?'; params.push(where.status); }
      const rows = await query(sql, params);
      return rows[0]?.count || 0;
    }
  },
  alertRule: {
    findMany: async (where?: any) => {
      let sql = 'SELECT * FROM alert_rules';
      const params: any[] = [];
      if (where?.isActive) { sql += ' WHERE isActive = ?'; params.push(where.isActive); }
      return await query(sql, params);
    },
    findFirst: async (where: any) => {
      const rules = await db.alertRule.findMany({ where, take: 1 });
      return rules[0] || null;
    },
    findUnique: async (where: any) => {
      if (where.id) { const rows = await query('SELECT * FROM alert_rules WHERE id = ?', [where.id]); return rows[0]; }
      return null;
    },
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO alert_rules (id, name, description, conditionType, conditionValue, severity, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [id, data.name, data.description, data.conditionType, data.conditionValue, data.severity, data.isActive]);
      return await db.alertRule.findUnique({ where: { id } });
    },
    update: async (args: any) => {
      const { where, data } = args;
      const updates: string[] = [];
      const params: any[] = [];
      if (data.name) { updates.push('name = ?'); params.push(data.name); }
      if (data.description) { updates.push('description = ?'); params.push(data.description); }
      if (data.isActive !== undefined) { updates.push('isActive = ?'); params.push(data.isActive); }
      updates.push('updatedAt = NOW()');
      let sql = 'UPDATE alert_rules SET ' + updates.join(', ');
      if (where.id) { sql += ' WHERE id = ?'; params.push(where.id); }
      await execute(sql, params);
      return await db.alertRule.findUnique(where);
    },
    delete: async (where: any) => {
      await execute('DELETE FROM alert_rules WHERE id = ?', [where.id]);
    }
  },
  auditLog: {
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO audit_log (id, userId, userEmail, action, resourceType, resourceId, details, ipAddress, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [id, data.userId, data.userEmail, data.action, data.resourceType, data.resourceId, data.details, data.ipAddress]);
    },
    findMany: async (args?: any) => {
      let sql = 'SELECT * FROM audit_log';
      const params: any[] = [];
      if (args?.where?.userId) { sql += ' WHERE userId = ?'; params.push(args.where.userId); }
      if (args?.orderBy) sql += ' ORDER BY createdAt DESC';
      if (args?.take) {
        const takeVal = parseInt(args.take, 10) || 50;
        sql += ' LIMIT ' + takeVal;
      }
      return await query(sql, params);
    },
    count: async (where?: any) => {
      let sql = 'SELECT COUNT(*) as count FROM audit_log';
      const params: any[] = [];
      if (where?.userId) { sql += ' WHERE userId = ?'; params.push(where.userId); }
      const rows = await query(sql, params);
      return rows[0]?.count || 0;
    }
  },
  anomaly: {
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO anomalies (id, type, severity, message, userId, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
        [id, data.type, data.severity, data.message, data.userId]);
    },
    findMany: async (args?: any) => {
      let sql = 'SELECT * FROM anomalies';
      const params: any[] = [];
      if (args?.where?.userId) { sql += ' WHERE userId = ?'; params.push(args.where.userId); }
      if (args?.orderBy) sql += ' ORDER BY detectedAt DESC';
      if (args?.take) {
        const takeVal = parseInt(args.take, 10) || 50;
        sql += ' LIMIT ' + takeVal;
      }
      return await query(sql, params);
    }
  },
  errorGroup: {
    findMany: async (args?: any) => {
      let sql = 'SELECT * FROM error_groups';
      const params: any[] = [];
      if (args?.where?.userId) { sql += ' WHERE userId = ?'; params.push(args.where.userId); }
      if (args?.where?.status) { sql += ' WHERE status = ?'; params.push(args.where.status); }
      if (args?.orderBy) sql += ' ORDER BY occurrenceCount DESC';
      if (args?.take) {
        const takeVal = parseInt(args.take, 10) || 50;
        sql += ' LIMIT ' + takeVal;
      }
      return await query(sql, params);
    },
    findFirst: async (where: any) => {
      const groups = await db.errorGroup.findMany({ where, take: 1 });
      return groups[0] || null;
    },
    findUnique: async (where: any) => {
      if (where.id) { const rows = await query('SELECT * FROM error_groups WHERE id = ?', [where.id]); return rows[0]; }
      return null;
    },
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO error_groups (id, fingerprint, title, eventType, severityMax, occurrenceCount, firstSeen, lastSeen, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [id, data.fingerprint, data.title, data.eventType, data.severityMax, data.occurrenceCount, data.firstSeen, data.lastSeen, data.userId]);
      return await db.errorGroup.findUnique({ where: { id } });
    },
    update: async (args: any) => {
      const { where, data } = args;
      const updates: string[] = [];
      const params: any[] = [];
      if (data.occurrenceCount) { updates.push('occurrenceCount = ?'); params.push(data.occurrenceCount); }
      if (data.lastSeen) { updates.push('lastSeen = ?'); params.push(data.lastSeen); }
      if (data.status) { updates.push('status = ?'); params.push(data.status); }
      if (data.resolvedAt) { updates.push('resolvedAt = ?'); params.push(data.resolvedAt); }
      updates.push('updatedAt = NOW()');
      let sql = 'UPDATE error_groups SET ' + updates.join(', ');
      if (where.id) { sql += ' WHERE id = ?'; params.push(where.id); }
      await execute(sql, params);
      return await db.errorGroup.findUnique(where);
    },
    delete: async (where: any) => {
      await execute('DELETE FROM error_groups WHERE id = ?', [where.id]);
    }
  },
  importJob: {
    create: async (data: any) => {
      const id = data.id || generateCuid();
      await execute('INSERT INTO import_jobs (id, filename, status, userId, createdAt) VALUES (?, ?, ?, ?, NOW())',
        [id, data.filename, data.status, data.userId]);
      return { id, ...data };
    },
    findUnique: async (where: any) => {
      if (where.id) { const rows = await query('SELECT * FROM import_jobs WHERE id = ?', [where.id]); return rows[0]; }
      return null;
    },
    update: async (args: any) => {
      const { where, data } = args;
      const updates: string[] = [];
      const params: any[] = [];
      if (data.status) { updates.push('status = ?'); params.push(data.status); }
      if (data.totalLines) { updates.push('totalLines = ?'); params.push(data.totalLines); }
      if (data.processedLines) { updates.push('processedLines = ?'); params.push(data.processedLines); }
      if (data.errorCount) { updates.push('errorCount = ?'); params.push(data.errorCount); }
      if (data.errorMessage) { updates.push('errorMessage = ?'); params.push(data.errorMessage); }
      let sql = 'UPDATE import_jobs SET ' + updates.join(', ');
      if (where.id) { sql += ' WHERE id = ?'; params.push(where.id); }
      await execute(sql, params);
      return await db.importJob.findUnique(where);
    },
    findMany: async (args?: any) => {
      let sql = 'SELECT * FROM import_jobs';
      const params: any[] = [];
      if (args?.where?.userId) { sql += ' WHERE userId = ?'; params.push(args.where.userId); }
      if (args?.orderBy) sql += ' ORDER BY createdAt DESC';
      if (args?.take) {
        const takeVal = parseInt(args.take, 10) || 50;
        sql += ' LIMIT ' + takeVal;
      }
      return await query(sql, params);
    }
  },
  watchOffset: {
    upsert: async (args: any) => {
      const { where, create, update } = args;
      const existing = await query('SELECT * FROM watch_offsets WHERE path = ?', [where.path]);
      if (existing.length > 0) {
        await execute('UPDATE watch_offsets SET fileOffset = ?, updatedAt = NOW() WHERE path = ?', [update.fileOffset, where.path]);
      } else {
        await execute('INSERT INTO watch_offsets (path, fileOffset, updatedAt) VALUES (?, ?, NOW())', [create.path, create.fileOffset]);
      }
    }
  }
};
