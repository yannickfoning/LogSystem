import pool from './config/database.js';
import { toMysqlUtcDatetime, utcTodayBounds, OPERATIONAL_TS } from './lib/operationalTime.js';

async function testApiResponseFormat() {
  console.log('=== Test format réponse API pour comparaison frontend ===\n');

  // Simuler l'endpoint /trends comme le code backend
  const now = new Date();
  const endDate = new Date(now);
  const endSql = toMysqlUtcDatetime(endDate);
  const startDate = new Date(now.getTime() - 6 * 86400000);
  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);
  const startSql = toMysqlUtcDatetime(startDate);

  const dates = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
  const seriesData = {};
  levels.forEach(l => { seriesData[l] = new Array(dates.length).fill(0); });

  const [rows] = await pool.execute(
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

  for (const row of rows) {
    const idx = dates.indexOf(row.day);
    const levelKey = String(row.log_level || '').toUpperCase();
    if (idx >= 0 && seriesData[levelKey] !== undefined) {
      seriesData[levelKey][idx] = Number(row.cnt);
    }
  }

  const dailyTotal = new Array(dates.length).fill(0);
  for (let i = 0; i < dates.length; i++) {
    levels.forEach(l => { dailyTotal[i] += seriesData[l][i]; });
  }

  const apiResponse = {
    dates,
    labels: dates,
    series: seriesData,
    info: seriesData.INFO,
    warning: seriesData.WARNING,
    error: seriesData.ERROR,
    critical: seriesData.CRITICAL,
    fatal: seriesData.FATAL,
    debug: seriesData.DEBUG,
    daily_total: dailyTotal,
    days: dates.length
  };

  console.log('Structure API response complète:');
  console.log(JSON.stringify(apiResponse, null, 2));

  console.log('\n=== Test check frontend ===');
  const hasAny = ['INFO','WARNING','ERROR','CRITICAL','FATAL','DEBUG'].some(function(k){
    return ((apiResponse.series||{})[k]||[]).some(function(v){ return Number(v)>0; });
  });
  console.log('hasAny (check frontend):', hasAny);

  console.log('\n=== Test terminé ===');
  process.exit(0);
}

testApiResponseFormat().catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
