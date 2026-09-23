import crypto from 'crypto';
import pool from '../config/database.js';
import { normalizeLevel, levelSeverity } from '../config/database.js';

// Parse CLI arguments
const args = process.argv.slice(2);
const fromArg = args.indexOf('--from');
const toArg = args.indexOf('--to');

let fromDate = new Date();
fromDate.setDate(fromDate.getDate() - 7); // Default: 7 days ago

let toDate = new Date(); // Default: today

if (fromArg !== -1 && args[fromArg + 1]) {
  fromDate = new Date(args[fromArg + 1]);
}
if (toArg !== -1 && args[toArg + 1]) {
  toDate = new Date(args[toArg + 1]);
}

// Configuration
const LOGS_PER_DAY = 10000;
const BATCH_SIZE = 500;
const TIME_SLOTS = [
  { start: 8, end: 12, weight: 0.4 },   // 40% between 8h-12h
  { start: 14, end: 18, weight: 0.6 }   // 60% between 14h-18h
];

// Realistic error patterns
const ERROR_PATTERNS = [
  {
    error_type: 'DatabaseConnectionError',
    event_type: 'database',
    level: 'ERROR',
    messages: [
      'Failed to connect to database: connection timeout',
      'Database connection lost during query execution',
      'Unable to establish connection to MySQL server',
      'Connection pool exhausted',
      'Database server not responding'
    ],
    services: ['api-service', 'worker-service', 'auth-service']
  },
  {
    error_type: 'AuthenticationFailure',
    event_type: 'authentication',
    level: 'ERROR',
    messages: [
      'Invalid credentials provided for user',
      'JWT token validation failed',
      'Session expired for user',
      'Authentication service unavailable',
      'Too many failed login attempts'
    ],
    services: ['auth-service', 'api-gateway']
  },
  {
    error_type: 'APITimeout',
    event_type: 'network',
    level: 'WARNING',
    messages: [
      'External API call timeout after 30s',
      'Slow response from payment gateway',
      'Third-party service unavailable',
      'Rate limit exceeded on external API',
      'Network latency spike detected'
    ],
    services: ['api-service', 'payment-service']
  },
  {
    error_type: 'MemoryLeak',
    event_type: 'system',
    level: 'CRITICAL',
    messages: [
      'Memory usage exceeded 90% threshold',
      'Heap size growing abnormally',
      'Potential memory leak detected in worker process',
      'GC pauses exceeding 500ms',
      'Out of memory error in background job'
    ],
    services: ['worker-service', 'batch-processor']
  },
  {
    error_type: 'DiskSpaceLow',
    event_type: 'system',
    level: 'WARNING',
    messages: [
      'Disk usage at 85% capacity',
      'Log directory approaching size limit',
      'Temp directory cleanup failed',
      'Storage space warning on /var/log',
      'Archive operation failed due to disk space'
    ],
    services: ['log-service', 'archive-service']
  },
  {
    error_type: 'ValidationError',
    event_type: 'validation',
    level: 'ERROR',
    messages: [
      'Invalid input parameter in request',
      'Schema validation failed for payload',
      'Missing required field in user data',
      'Data type mismatch in API call',
      'Business rule violation detected'
    ],
    services: ['api-service', 'validation-service']
  },
  {
    error_type: 'CacheMiss',
    event_type: 'cache',
    level: 'INFO',
    messages: [
      'Cache miss for frequently accessed key',
      'Redis connection timeout',
      'Cache eviction policy triggered',
      'Cold start cache population',
      'Cache stale data detected'
    ],
    services: ['cache-service', 'api-service']
  },
  {
    error_type: 'ProcessCrash',
    event_type: 'system',
    level: 'FATAL',
    messages: [
      'Worker process crashed unexpectedly',
      'Main process terminated with signal 11',
      'Unhandled exception in background job',
      'Process killed by OOM killer',
      'Service restart required after crash'
    ],
    services: ['worker-service', 'main-service']
  }
];

// Helper functions
function generateFingerprint(service, eventType, normalizedMessage, userId = null) {
  const str = `${service || ''}|||${eventType || ''}|||${normalizedMessage || ''}|||${userId || ''}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 40);
}

function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateTimestamp(baseDate, timeSlots) {
  const slot = getRandomItem(timeSlots);
  const startHour = slot.start;
  const endHour = slot.end;
  
  const randomHour = startHour + Math.random() * (endHour - startHour);
  const randomMinute = Math.random() * 60;
  const randomSecond = Math.random() * 60;
  const randomMs = Math.random() * 1000;
  
  const timestamp = new Date(baseDate);
  timestamp.setHours(Math.floor(randomHour), Math.floor(randomMinute), Math.floor(randomSecond), Math.floor(randomMs));
  
  return timestamp;
}

function normalizeMessage(message) {
  // Simple normalization - remove numbers and specific IDs for grouping
  return message
    .replace(/\d+/g, 'N')
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL')
    .trim();
}

function generateLogEntry(date, userId) {
  const pattern = getRandomItem(ERROR_PATTERNS);
  const message = getRandomItem(pattern.messages);
  const service = getRandomItem(pattern.services);
  const normalizedMessage = normalizeMessage(message);
  const fingerprint = generateFingerprint(service, pattern.event_type, normalizedMessage, userId);
  
  // Add some randomness to make logs more realistic
  const logId = crypto.randomBytes(16).toString('hex');
  const source = `${service}-${Math.floor(Math.random() * 10)}.log`;
  const module = getRandomItem(['auth', 'database', 'api', 'worker', 'cache', 'validation']);
  
  return {
    timestamp: generateTimestamp(date, TIME_SLOTS),
    message: message,
    log_level: pattern.level,
    event_type: pattern.event_type,
    source: source,
    service: service,
    module: module,
    fingerprint: fingerprint,
    error_type: pattern.error_type,
    user_id: userId,
    imported_at: new Date()
  };
}

async function insertBatch(logs) {
  try {
    const values = logs.map(log => [
      log.timestamp,
      log.message,
      log.log_level,
      log.event_type,
      log.source,
      log.service,
      log.module,
      log.fingerprint,
      log.error_type,
      log.user_id,
      log.imported_at
    ]);

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flatValues = values.flat();

    const [result] = await pool.execute(
      `INSERT IGNORE INTO logs (timestamp, message, log_level, event_type, source, service, module, fingerprint, error_type, user_id, imported_at)
       VALUES ${placeholders}`,
      flatValues
    );
    
    return { success: true, count: result.affectedRows };
  } catch (error) {
    console.error('Batch insert failed:', error.message);
    return { success: false, error: error.message, count: 0 };
  }
}

async function seedLogs() {
  console.log('=== Production Log Seeding ===');
  console.log(`From: ${fromDate.toISOString().split('T')[0]}`);
  console.log(`To: ${toDate.toISOString().split('T')[0]}`);
  console.log(`Logs per day: ${LOGS_PER_DAY}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log();

  try {
    // Get first active user
    const [users] = await pool.execute('SELECT id FROM users WHERE is_active = 1 LIMIT 1');
    if (!users.length) {
      console.error('No active users found. Please create a user first.');
      process.exit(1);
    }
    const userId = users[0].id;
    console.log(`Using user ID: ${userId}`);
    console.log();

    let totalInserted = 0;
    let totalFailed = 0;
    let currentDate = new Date(fromDate);

    while (currentDate <= toDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      console.log(`Processing ${dateStr}...`);
      
      let dailyLogs = [];
      let dailyInserted = 0;
      let dailyFailed = 0;

      // Generate logs for the day
      for (let i = 0; i < LOGS_PER_DAY; i++) {
        dailyLogs.push(generateLogEntry(currentDate, userId));
        
        // Insert in batches
        if (dailyLogs.length >= BATCH_SIZE) {
          const result = await insertBatch(dailyLogs);
          if (result.success) {
            dailyInserted += result.count;
            totalInserted += result.count;
          } else {
            dailyFailed += dailyLogs.length;
            totalFailed += dailyLogs.length;
          }
          dailyLogs = [];
        }
      }

      // Insert remaining logs
      if (dailyLogs.length > 0) {
        const result = await insertBatch(dailyLogs);
        if (result.success) {
          dailyInserted += result.count;
          totalInserted += result.count;
        } else {
          dailyFailed += dailyLogs.length;
          totalFailed += dailyLogs.length;
        }
      }

      console.log(`  Inserted: ${dailyInserted}, Failed: ${dailyFailed}`);
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log();
    console.log('=== Seeding Complete ===');
    console.log(`Total inserted: ${totalInserted}`);
    console.log(`Total failed: ${totalFailed}`);
    
    // Verify final count
    const [countResult] = await pool.execute('SELECT COUNT(*) as total FROM logs WHERE user_id = ?', [userId]);
    console.log(`Total logs in database for user ${userId}: ${countResult[0].total}`);

  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run seeding
seedLogs();