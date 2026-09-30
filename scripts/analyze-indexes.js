import pool from '../config/database.js';

async function analyzeIndexes() {
  console.log('=== Index Analysis for Performance Optimization ===\n');
  
  try {
    const conn = await pool.getConnection();
    
    // Query 1: Recommendations by-frequency
    console.log('1. EXPLAIN for recommendations by-frequency query:');
    const [explain1] = await conn.query(`
      EXPLAIN SELECT 
        rf.error_type, rf.occurrence_count, rf.log_level, 
        er.recommendation, er.priority, er.recommendation_category, er.severity_level, 
        rf.last_triggered, COUNT(DISTINCT l.id) as sample_count
      FROM recommendation_frequency rf
      LEFT JOIN error_recommendations er ON rf.recommendation_id = er.id
      LEFT JOIN logs l ON l.error_type = rf.error_type AND l.user_id = 1
      WHERE rf.user_id = 1 AND rf.occurrence_count >= 5
      GROUP BY rf.error_type, rf.log_level
      ORDER BY rf.occurrence_count DESC, er.priority DESC
      LIMIT 15
    `);
    console.log(JSON.stringify(explain1, null, 2));
    console.log();

    // Query 2: Top errors grouped
    console.log('2. EXPLAIN for top errors grouped query:');
    const [explain2] = await conn.query(`
      EXPLAIN SELECT 
        eg.id, eg.fingerprint, eg.title, eg.error_type, eg.event_type, eg.severity_max,
        eg.occurrence_count, eg.first_seen, eg.last_seen, eg.status, eg.return_count,
        eg.returned_at, eg.source_server, eg.service,
        COUNT(DISTINCT l.id) as recent_count, MAX(l.timestamp) as most_recent,
        GROUP_CONCAT(DISTINCT l.module SEPARATOR ',') as affected_modules
      FROM error_groups eg
      LEFT JOIN logs l ON l.fingerprint = eg.fingerprint AND l.user_id = 1 
        AND l.timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      WHERE eg.user_id = 1 AND eg.status IN ('open', 'returned')
      GROUP BY eg.id
      ORDER BY eg.occurrence_count DESC
      LIMIT 20
    `);
    console.log(JSON.stringify(explain2, null, 2));
    console.log();

    // Query 3: Pattern analysis
    console.log('3. EXPLAIN for pattern analysis query:');
    const [explain3] = await conn.query(`
      EXPLAIN SELECT 
        error_type, log_level, event_type, COUNT(*) as frequency, MAX(timestamp) as last_occurrence
      FROM logs
      WHERE user_id = 1 AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')
      GROUP BY error_type, log_level, event_type
      HAVING frequency >= 3
      ORDER BY frequency DESC
      LIMIT 20
    `);
    console.log(JSON.stringify(explain3, null, 2));
    console.log();

    // Check current indexes on key tables
    console.log('4. Current indexes on logs table:');
    const [logsIndexes] = await conn.query('SHOW INDEX FROM logs');
    const indexNames = [...new Set(logsIndexes.map(idx => idx.Key_name))];
    indexNames.forEach(name => {
      const columns = logsIndexes.filter(idx => idx.Key_name === name).map(idx => idx.Column_name);
      console.log(`  ${name}: ${columns.join(', ')}`);
    });
    console.log();

    console.log('5. Current indexes on error_groups table:');
    const [egIndexes] = await conn.query('SHOW INDEX FROM error_groups');
    const egIndexNames = [...new Set(egIndexes.map(idx => idx.Key_name))];
    egIndexNames.forEach(name => {
      const columns = egIndexes.filter(idx => idx.Key_name === name).map(idx => idx.Column_name);
      console.log(`  ${name}: ${columns.join(', ')}`);
    });
    console.log();

    console.log('6. Current indexes on recommendation_frequency table:');
    const [rfIndexes] = await conn.query('SHOW INDEX FROM recommendation_frequency');
    const rfIndexNames = [...new Set(rfIndexes.map(idx => idx.Key_name))];
    rfIndexNames.forEach(name => {
      const columns = rfIndexes.filter(idx => idx.Key_name === name).map(idx => idx.Column_name);
      console.log(`  ${name}: ${columns.join(', ')}`);
    });
    console.log();

    // Check table sizes
    console.log('7. Table sizes:');
    const [tableSizes] = await conn.query(`
      SELECT 
        table_name, 
        table_rows, 
        ROUND(data_length / 1024 / 1024, 2) as data_mb,
        ROUND(index_length / 1024 / 1024, 2) as index_mb
      FROM information_schema.tables
      WHERE table_schema = 'logsystem' 
        AND table_name IN ('logs', 'error_groups', 'recommendation_frequency', 'error_recommendations')
      ORDER BY data_length DESC
    `);
    tableSizes.forEach(table => {
      console.log(`  ${table.table_name}: ${table.table_rows} rows, ${table.data_mb}MB data, ${table.index_mb}MB index`);
    });
    console.log();

    conn.release();
  } catch (error) {
    console.error('Analysis failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

analyzeIndexes();