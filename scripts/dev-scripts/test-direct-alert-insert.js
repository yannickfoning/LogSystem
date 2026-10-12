import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Test direct alert insertion ===');

// Try to insert an alert directly
const alertData = {
  rule_id: 107,
  user_id: 1,
  alert_type: 'level',
  severity: 'high',
  message: 'Test direct alert insertion - FATAL detected',
  status: 'new',
  metadata: JSON.stringify({ test: true, timestamp: new Date().toISOString() })
};

console.log('Inserting alert:', alertData.message);

try {
  const [result] = await connection.execute(
    `INSERT INTO alerts (rule_id, user_id, alert_type, severity, message, status, metadata, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [alertData.rule_id, alertData.user_id, alertData.alert_type, alertData.severity, alertData.message, alertData.status, alertData.metadata]
  );
  
  console.log('✅ Alert inserted successfully, ID:', result.insertId);
  
  // Verify the insertion
  const [newAlert] = await connection.execute(
    'SELECT * FROM alerts WHERE id = ?',
    [result.insertId]
  );
  
  console.log('Inserted alert data:', JSON.stringify(newAlert[0], null, 2));
  
} catch (error) {
  console.log('❌ Alert insertion failed:', error.message);
}

// Check if there are any existing alerts that might block deduplication
console.log('\n=== Check existing alerts for rule 107 ===');
const [existingAlerts] = await connection.execute(
  'SELECT id, rule_id, user_id, message, created_at, resolved_at FROM alerts WHERE rule_id = 107 ORDER BY id DESC'
);

console.log('Existing alerts for rule 107:', existingAlerts.length);
existingAlerts.forEach(alert => {
  const msg = alert.message.length > 50 ? alert.message.substring(0, 50) + '...' : alert.message;
  console.log('ID:', alert.id, ', Created:', alert.created_at, ', Resolved:', alert.resolved_at, ', Message:', msg);
});

await connection.end();
