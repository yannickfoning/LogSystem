import mysql from 'mysql2/promise';

// Configuration de la connexion MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
});

// Interface pour les résultats de requêtes
export interface QueryResult {
  insertId?: number;
  affectedRows?: number;
  rows?: any[];
}

// Fonction utilitaire pour exécuter des requêtes
export async function query(sql: string, params?: any[]): Promise<any> {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('SQL Query Error:', error);
    throw error;
  }
}

// Fonction utilitaire pour exécuter des requêtes avec retour d'information
export async function execute(sql: string, params?: any[]): Promise<QueryResult> {
  try {
    const [result] = await pool.execute(sql, params);
    return result as QueryResult;
  } catch (error) {
    console.error('SQL Execute Error:', error);
    throw error;
  }
}

// Test de connexion
export async function testConnection(): Promise<boolean> {
  try {
    await pool.getConnection();
    console.log('[SQL] Database connection successful');
    return true;
  } catch (error) {
    console.error('[SQL] Database connection failed:', error);
    return false;
  }
}

// Fermeture propre de la connexion
export async function closeConnection(): Promise<void> {
  await pool.end();
  console.log('[SQL] Database connection closed');
}

export default pool;
