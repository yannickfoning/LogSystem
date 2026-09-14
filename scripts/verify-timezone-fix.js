/**
 * Preuve avant/après : fenêtres UTC vs Date JS brute (simule l'ancien bug fuseau).
 */
import '../config/loadEnv.js';
import pool from '../config/database.js';
import { OPERATIONAL_TS, mysqlUtcMinutesAgo, utcBoundsForCalendarDate, utcTodayBounds } from '../lib/operationalTime.js';

const minutes = 60;
const now = new Date();
const windowUtc = mysqlUtcMinutesAgo(minutes, now);
const windowDateObj = new Date(now.getTime() - minutes * 60000);

async function countSince(label, param) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ?`,
    [param]
  );
  console.log(`${label}: cnt=${rows[0].cnt}  param=${param instanceof Date ? param.toISOString() : param}`);
  return rows[0].cnt;
}

async function main() {
  const [tz] = await pool.execute("SELECT @@session.time_zone AS tz");
  console.log('=== Session timezone ===');
  console.log('@@session.time_zone =', tz[0].tz);

  console.log('\n=== Sliding window (60 min) ===');
  const cUtc = await countSince('UTC string (fix)', windowUtc);
  const cDate = await countSince('Date object (legacy)', windowDateObj);

  const today = utcTodayBounds();
  console.log('\n=== Today bounds (UTC) ===', today);

  const [todayCnt] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ? AND ${OPERATIONAL_TS} <= ?`,
    [today.start, today.end]
  );
  console.log('Logs today (UTC window):', todayCnt[0].cnt);

  // Simulate old dashboard bug: local midnight → toISOString
  const localStart = new Date();
  localStart.setHours(0, 0, 0, 0);
  const localEnd = new Date();
  const oldStartSql = localStart.toISOString().slice(0, 19).replace('T', ' ');
  const oldEndSql = localEnd.toISOString().slice(0, 19).replace('T', ' ');

  const day = now.toISOString().slice(0, 10);
  const fixed = utcBoundsForCalendarDate(day);

  const [oldCnt] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ? AND ${OPERATIONAL_TS} <= ?`,
    [oldStartSql, oldEndSql]
  );
  const [newCnt] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ? AND ${OPERATIONAL_TS} <= ?`,
    [fixed.start, fixed.end]
  );

  console.log('\n=== Dashboard "today" window ===');
  console.log('OLD (local setHours + toISOString):', oldStartSql, '→', oldEndSql, 'cnt=', oldCnt[0].cnt);
  console.log('NEW (utcBoundsForCalendarDate):    ', fixed.start, '→', fixed.end, 'cnt=', newCnt[0].cnt);

  if (cUtc !== cDate) {
    console.log('\n⚠️  Différence fenêtre glissante UTC vs Date — timezone:Z + strings explicites nécessaires.');
  }
  if (oldCnt[0].cnt !== newCnt[0].cnt) {
    console.log('\n⚠️  Différence fenêtre "today" — fix dashboard pertinent.');
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
