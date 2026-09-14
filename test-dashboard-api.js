import pool from './config/database.js';
import { toMysqlUtcDatetime, utcTodayBounds, OPERATIONAL_TS } from './lib/operationalTime.js';

async function testDashboardApi() {
  console.log('=== Test des endpoints Dashboard ===\n');

  // Test 1: Summary
  console.log('Test 1: /api/dashboard/summary');
  const { start: todayStartSql } = utcTodayBounds();
  const [total] = await pool.execute('SELECT COUNT(*) as cnt FROM logs WHERE 1=1');
  const [importedToday] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ?`,
    [todayStartSql]
  );
  const [errorCount] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ? AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')`,
    [todayStartSql]
  );
  const [unreadAlerts] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM alerts WHERE status = 'new' AND user_id = ?",
    [1]
  );
  const [fatalCount] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM logs WHERE log_level = 'FATAL' AND user_id = ?",
    [1]
  );
  const [criticalCount] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM logs WHERE log_level = 'CRITICAL' AND user_id = ?",
    [1]
  );
  const [sourceCount] = await pool.execute(
    'SELECT COUNT(DISTINCT source) as cnt FROM logs WHERE source IS NOT NULL AND source != \'\' AND user_id = ?',
    [1]
  );
  const [levelRows] = await pool.execute(
    'SELECT log_level, COUNT(*) as cnt FROM logs WHERE log_level IS NOT NULL AND user_id = ? GROUP BY log_level',
    [1]
  );

  const levels = {};
  for (const row of levelRows) {
    levels[String(row.log_level || '').toUpperCase()] = Number(row.cnt);
  }

  const summaryData = {
    total_logs: Number(total[0].cnt),
    today_logs: Number(importedToday[0].cnt),
    error_count: Number(errorCount[0].cnt),
    unread_alerts: Number(unreadAlerts[0].cnt),
    fatal_count: Number(fatalCount[0].cnt),
    critical_count: Number(criticalCount[0].cnt),
    source_count: Number(sourceCount[0].cnt),
    levels_breakdown: levels
  };
  console.log('✓ Summary data:', JSON.stringify(summaryData, null, 2));

  // Test 2: Trends
  console.log('\nTest 2: /api/dashboard/trends');
  const now = new Date();
  const endDate = new Date(now);
  const endSql = toMysqlUtcDatetime(endDate);
  const startDate = new Date(now.getTime() - 6 * 86400000);
  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);
  const startSql = toMysqlUtcDatetime(startDate);

  const [trends] = await pool.execute(
    `SELECT DATE_FORMAT(${OPERATIONAL_TS}, '%Y-%m-%d') AS day,
            UPPER(log_level) AS log_level,
            COUNT(*) AS cnt
     FROM logs
     WHERE ${OPERATIONAL_TS} IS NOT NULL 
       AND ${OPERATIONAL_TS} >= ? 
       AND ${OPERATIONAL_TS} <= ? AND user_id = ?
     GROUP BY DATE_FORMAT(${OPERATIONAL_TS}, '%Y-%m-%d'), UPPER(log_level)
     ORDER BY day ASC`,
    [startSql, endSql, 1]
  );
  console.log('✓ Trends rows:', trends.length);
  if (trends.length > 0) {
    console.log('Sample trends:', trends.slice(0, 5));
  }

  // Test 3: Per-level
  console.log('\nTest 3: /api/dashboard/per-level');
  const [perLevel] = await pool.execute(
    'SELECT log_level, COUNT(*) as cnt FROM logs WHERE log_level IS NOT NULL AND user_id = ? GROUP BY log_level',
    [1]
  );
  console.log('✓ Per-level rows:', perLevel.length);
  const perLevelData = {};
  perLevel.forEach(row => {
    perLevelData[row.log_level] = row.cnt;
  });
  console.log('Per-level data:', perLevelData);

  // Test 4: Recent logs
  console.log('\nTest 4: /api/dashboard/recent-logs');
  const [recent] = await pool.execute(
    `SELECT id, timestamp, imported_at, log_level, message 
     FROM logs WHERE user_id = ?
     ORDER BY ${OPERATIONAL_TS} DESC LIMIT 10`,
    [1]
  );
  console.log('✓ Recent logs:', recent.length);
  if (recent.length > 0) {
    console.log('Sample recent log:', recent[0]);
  }

  console.log('\n=== Test terminé ===');
  process.exit(0);
}

testDashboardApi().catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
