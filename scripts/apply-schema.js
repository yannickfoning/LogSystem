import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    const dbName = process.env.DB_NAME || 'logsystem';
    await connection.execute(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    // Optional: clean existing tables to avoid tablespace import conflicts.
    // Set DISCARD_TABLESPACE=1 to drop tables first.
    if (process.env.DISCARD_TABLESPACE === '1') {
      const [tables] = await connection.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = ?`,
        [dbName]
      );
      for (const t of tables) {
        await connection.execute(`DROP TABLE IF EXISTS \`${t.table_name}\``);
      }
    }

    await connection.changeUser({ database: dbName });


    // Support JSON-configured choice of schema/migration files.
    // Useful when switching to a newly created DB.
    const schemaFile = process.env.SCHEMA_FILE || 'schema.sql';
    const schemaPath = path.join(__dirname, '..', 'db', schemaFile);

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`[SCHEMA] File not found: ${schemaPath}`);
    }

    const rawSql = fs.readFileSync(schemaPath, 'utf8');

    // Statement-by-statement execution for resilience with MariaDB/MySQL + SET statements.
    // We also strip a few known SET statements.
    const statements = rawSql
      .split(/;\s*(?:\r?\n|$)/)
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => {
        const t = s.trim();
        if (/^SET\s+NAMES\s+/i.test(t)) return false;
        if (/^SET\s+FOREIGN_KEY_CHECKS\s*=\s*0\s*$/i.test(t)) return false;
        if (/^SET\s+FOREIGN_KEY_CHECKS\s*=\s*1\s*$/i.test(t)) return false;
        return true;
      });

    for (const st of statements) {
      await connection.execute(st);
    }

    // Optionally apply migration_v5 after base schema
    if (process.env.APPLY_MIGRATION_V5 === '1') {
      const migrationPath = path.join(__dirname, '..', 'db', 'migration_v5.sql');
      if (!fs.existsSync(migrationPath)) {
        throw new Error(`[SCHEMA] Migration file not found: ${migrationPath}`);
      }
      const migration = fs.readFileSync(migrationPath, 'utf8');

      const migrationStatements = migration
        .split(/;\s*(?:\r?\n|$)/)
        .map(s => s.trim())
        .filter(Boolean);

      for (const st of migrationStatements) {
        await connection.execute(st);
      }
    }

    console.log('[SCHEMA] Database schema applied successfully');
  } finally {
    await connection.end();
  }
}

main().catch(e => {
  console.error('[SCHEMA] Error:', e.message);
  process.exit(1);
});

