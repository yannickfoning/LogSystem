import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Check alert rules configuration ===');
const [rules] = await connection.execute(
  'SELECT id, name, condition_type, condition_value, threshold_value, is_global, created_by, applicable_to_users FROM alert_rules WHERE is_active = 1 ORDER BY id'
);

console.log('Active alert rules:', rules.length);
rules.forEach(rule => {
  console.log('ID:', rule.id, ', Name:', rule.name, ', Type:', rule.condition_type, ', Value:', rule.condition_value);
  console.log('  is_global:', rule.is_global, ', created_by:', rule.created_by, ', applicable_to_users:', rule.applicable_to_users);
});

console.log('\n=== Check which rules should be evaluated for user 1 ===');
const userId = 1;
const userRules = rules.filter(rule => {
  if (rule.is_global === 1) {
    const applicableUsers = rule.applicable_to_users;
    if (!applicableUsers || applicableUsers === '[]' || applicableUsers === null) {
      return true; // Global rule applicable to all
    }
    try {
      const users = JSON.parse(applicableUsers);
      return users.includes(userId);
    } catch (e) {
      return false;
    }
  } else {
    return rule.created_by === userId; // User-specific rule
  }
});

console.log('Rules that should be evaluated for user 1:', userRules.length);
userRules.forEach(rule => {
  console.log('ID:', rule.id, ', Name:', rule.name, ', Type:', rule.condition_type);
});

console.log('\n=== Check recent FATAL logs count for user 1 ===');
const [fatalCount] = await connection.execute(
  'SELECT COUNT(*) as cnt FROM logs WHERE log_level = "FATAL" AND user_id = 1'
);
console.log('FATAL logs for user 1:', fatalCount[0].cnt);

console.log('\n=== Check recent FATAL logs in last 5 minutes ===');
const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19).replace('T', ' ');
const [recentFatal] = await connection.execute(
  'SELECT COUNT(*) as cnt FROM logs WHERE log_level = "FATAL" AND user_id = 1 AND timestamp >= ?',
  [fiveMinutesAgo]
);
console.log('FATAL logs for user 1 in last 5 minutes:', recentFatal[0].cnt);

await connection.end();
