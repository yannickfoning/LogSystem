/**
 * Vitest Global Setup
 * Runs once before all test files to initialize the test database schema
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const TEST_DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.TEST_DB_NAME || 'logsystem_test',
  multipleStatements: true
};

let pool = null;

export async function setup() {
  console.log('[GLOBAL-SETUP] Initializing test database schema...');
  
  try {
    // First connect without database to create it if needed
    const adminPool = mysql.createPool({
      host: TEST_DB_CONFIG.host,
      port: TEST_DB_CONFIG.port,
      user: TEST_DB_CONFIG.user,
      password: TEST_DB_CONFIG.password,
      multipleStatements: true
    });
    
    // Create test database if it doesn't exist
    await adminPool.execute(
      `CREATE DATABASE IF NOT EXISTS \`${TEST_DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`[GLOBAL-SETUP] Database ${TEST_DB_CONFIG.database} ensured`);
    
    await adminPool.end();
    
    // Now connect to the test database
    pool = mysql.createPool(TEST_DB_CONFIG);
    
    // Test connection
    await pool.execute('SELECT 1');
    console.log('[GLOBAL-SETUP] Database connection established');
    
    // Initialize schema
    await initializeSchema();
    
    console.log('[GLOBAL-SETUP] Schema initialization complete');
  } catch (error) {
    console.error('[GLOBAL-SETUP] Failed to initialize test database:', error.message);
    throw error;
  }
}

export async function teardown() {
  console.log('[GLOBAL-SETUP] Cleaning up global setup...');
  
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[GLOBAL-SETUP] Database connection closed');
  }
}

async function initializeSchema() {
  try {
    const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      console.warn('[GLOBAL-SETUP] Schema file not found:', schemaPath);
      return;
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`[GLOBAL-SETUP] Executing ${statements.length} schema statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        await pool.execute(statement);
      } catch (error) {
        // Ignore errors for tables that already exist
        if (!error.message.includes('already exists') && 
            !error.message.includes('Duplicate key') &&
            !error.message.includes('Unknown table') &&
            !error.message.includes('Tablespace')) {
          console.warn(`[GLOBAL-SETUP] Statement ${i + 1} warning:`, error.message);
        }
      }
    }
    
    console.log('[GLOBAL-SETUP] All schema statements executed');
  } catch (error) {
    console.error('[GLOBAL-SETUP] Schema initialization failed:', error.message);
    throw error;
  }
}