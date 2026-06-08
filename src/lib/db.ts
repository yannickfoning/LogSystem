import { db as sqlDb } from './sql-helpers';
import { testConnection } from './sql-db';

// Test connection on startup
if (process.env.NODE_ENV !== 'test') {
  testConnection().catch(err => {
    console.error('[DB] Failed to connect to database:', err);
  });
}

// Export the SQL db object that mimics Prisma API
export const db = sqlDb;
