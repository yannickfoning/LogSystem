import pool from './config/database.js';
import { toMysqlUtcDatetime, utcTodayBounds, OPERATIONAL_TS } from './lib/operationalTime.js';

async function testDashboardQueries() {
  console.log('=== Test des requêtes Dashboard avec UTC explicite ===\n');

  // Test 1: Summary - today logs
  const { start: todayStartSql } = utcTodayBounds();
  console.log('Test 1: Summary - logs depuis', todayStartSql);
  const [total] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ?`,
    [todayStartSql]
  );
  console.log('✓ Total logs depuis today:', total[0].cnt);

  const [errorCount] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ? AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')`,
    [todayStartSql]
  );
  console.log('✓ Erreurs depuis today:', errorCount[0].cnt);

  // Test 2: Trends - last 7 days
  const now = new Date();
  const endDate = new Date(now);
  const endSql = toMysqlUtcDatetime(endDate);
  const startDate = new Date(now.getTime() - 6 * 86400000);
  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);
  const startSql = toMysqlUtcDatetime(startDate);

  console.log('\nTest 2: Trends - last 7 days');
  console.log('From:', startSql, 'To:', endSql);

  const [trends] = await pool.execute(
    `SELECT DATE_FORMAT(${OPERATIONAL_TS}, '%Y-%m-%d') AS day,
            UPPER(log_level) AS log_level,
            COUNT(*) AS cnt
     FROM logs
     WHERE ${OPERATIONAL_TS} IS NOT NULL 
       AND ${OPERATIONAL_TS} >= ? 
       AND ${OPERATIONAL_TS} <= ?
     GROUP BY DATE_FORMAT(${OPERATIONAL_TS}, '%Y-%m-%d'), UPPER(log_level)
     ORDER BY day ASC`,
    [startSql, endSql]
  );
  console.log('✓ Trends rows:', trends.length);
  if (trends.length > 0) {
    console.log('Sample trends:', trends.slice(0, 5));
  }

  // Test 3: Per-level (sans filtre de date)
  console.log('\nTest 3: Per-level - tous les logs');
  const [perLevel] = await pool.execute(
    'SELECT log_level, COUNT(*) as cnt FROM logs WHERE log_level IS NOT NULL GROUP BY log_level'
  );
  console.log('✓ Per-level rows:', perLevel.length);
  perLevel.forEach(row => {
    console.log(`  ${row.log_level}: ${row.cnt}`);
  });

  // Test 4: Recent logs
  console.log('\nTest 4: Recent logs - 10 derniers');
  const [recent] = await pool.execute(
    `SELECT id, timestamp, imported_at, log_level, message 
     FROM logs 
     ORDER BY ${OPERATIONAL_TS} DESC LIMIT 10`
  );
  console.log('✓ Recent logs:', recent.length);
  if (recent.length > 0) {
    console.log('Sample recent log:', recent[0]);
  }

  console.log('\n=== Test terminé ===');
  process.exit(0);
}

testDashboardQueries().catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
