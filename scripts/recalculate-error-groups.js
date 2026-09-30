import pool from '../config/database.js';

async function recalculateErrorGroups() {
  console.log('=== Recalculating Error Groups ===');
  
  try {
    // Get first active user
    const [users] = await pool.execute('SELECT id FROM users WHERE is_active = 1 LIMIT 1');
    if (!users.length) {
      console.error('No active users found.');
      process.exit(1);
    }
    const userId = users[0].id;
    console.log(`Processing user ID: ${userId}`);
    console.log();

    // Clear existing error groups for this user
    console.log('Clearing existing error groups...');
    await pool.execute('DELETE FROM error_groups WHERE user_id = ?', [userId]);
    console.log('Existing error groups cleared.');
    console.log();

    // Get all logs grouped by fingerprint
    console.log('Grouping logs by fingerprint...');
    const [logGroups] = await pool.execute(
      `SELECT 
        fingerprint,
        error_type,
        event_type,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen,
        MAX(log_level) as severity_max,
        COUNT(*) as occurrence_count,
        MIN(id) as sample_log_id,
        GROUP_CONCAT(DISTINCT source SEPARATOR ',') as sources,
        GROUP_CONCAT(DISTINCT service SEPARATOR ',') as services
       FROM logs
       WHERE user_id = ?
       GROUP BY fingerprint, error_type, event_type`,
      [userId]
    );
    
    console.log(`Found ${logGroups.length} unique error patterns.`);
    console.log();

    // Insert new error groups
    console.log('Creating error groups...');
    let inserted = 0;
    
    for (const group of logGroups) {
      const title = group.fingerprint.slice(0, 100);
      
      await pool.execute(
        `INSERT INTO error_groups (
          fingerprint, title, error_type, event_type, severity_max,
          occurrence_count, first_seen, last_seen, sample_log_id,
          source_server, service, user_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          group.fingerprint,
          title,
          group.error_type,
          group.event_type,
          group.severity_max,
          group.occurrence_count,
          group.first_seen,
          group.last_seen,
          group.sample_log_id,
          group.sources ? group.sources.split(',')[0] : null,
          group.services ? group.services.split(',')[0] : null,
          userId
        ]
      );
      
      inserted++;
      if (inserted % 100 === 0) {
        console.log(`  Processed ${inserted}/${logGroups.length} groups...`);
      }
    }
    
    console.log(`Created ${inserted} error groups.`);
    console.log();

    // Verify results
    const [stats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_groups,
        SUM(occurrence_count) as total_occurrences,
        AVG(occurrence_count) as avg_occurrences
       FROM error_groups
       WHERE user_id = ?`,
      [userId]
    );
    
    console.log('=== Results ===');
    console.log(`Total error groups: ${stats[0].total_groups}`);
    console.log(`Total occurrences: ${stats[0].total_occurrences}`);
    const avg = stats[0].avg_occurrences ? parseFloat(stats[0].avg_occurrences).toFixed(2) : 'N/A';
    console.log(`Average occurrences per group: ${avg}`);
    console.log();

    // Show top 10 error groups
    const [topGroups] = await pool.execute(
      `SELECT id, title, error_type, occurrence_count, severity_max
       FROM error_groups
       WHERE user_id = ?
       ORDER BY occurrence_count DESC
       LIMIT 10`,
      [userId]
    );
    
    console.log('Top 10 Error Groups:');
    topGroups.forEach((g, i) => {
      console.log(`  ${i + 1}. ${g.error_type || 'Unknown'}: ${g.occurrence_count} occurrences (${g.severity_max})`);
    });

  } catch (error) {
    console.error('Recalculation failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

recalculateErrorGroups();