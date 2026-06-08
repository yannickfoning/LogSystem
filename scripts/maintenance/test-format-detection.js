#!/usr/bin/env node
/**
 * Test script for AMÉLIORATION 5 - Multi-Format Detection
 */

import { detectFormat, parseLogsByFormat } from '../lib/processing/detectFormat.js';

// Test samples for each format
const testSamples = {
  json: JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', message: 'Test error' }),
  
  jsonl: `{"timestamp":"2024-01-01T10:00:00Z","level":"INFO","message":"Line 1"}
{"timestamp":"2024-01-01T10:00:01Z","level":"ERROR","message":"Line 2"}`,

  csv: `timestamp,level,source,message
2024-01-01T10:00:00Z,INFO,app1,Log message 1
2024-01-01T10:00:01Z,ERROR,app2,Error message`,

  xml: `<?xml version="1.0"?>
<logs>
  <log>
    <timestamp>2024-01-01T10:00:00Z</timestamp>
    <level>ERROR</level>
    <message>Test error</message>
  </log>
</logs>`,

  syslog_rfc5424: `<134>1 2024-01-01T10:00:00Z server app pid - - Test message from RFC5424`,

  syslog_rfc3164: `<134>Jan  1 10:00:00 server app[1234]: Test message from RFC3164`,

  apache_nginx: `[01/Jan/2024:10:00:00 +0000] [core:error] [pid 1234:tid 5678] Test error from Apache`,

  windows_event: `Log Name: System
Source: KERNEL
Date: 2024-01-01T10:00:00
Event ID: 1000
Type: Error
Description: Windows Event Log message`,

  network_firewall: `src=192.168.1.1 dst=10.0.0.1 sport=45678 dport=443 proto=tcp action=BLOCK`
};

async function runTests() {
  console.log('🧪 Testing AMÉLIORATION 5 - Multi-Format Detection\n');
  console.log('='.repeat(60));

  for (const [format, sample] of Object.entries(testSamples)) {
    const buffer = Buffer.from(sample);
    const detected = detectFormat(buffer);
    
    const status = detected === format || (format.startsWith('syslog') && detected === 'syslog') ? '✅' : '❌';
    
    console.log(`\n${status} Format: ${format}`);
    console.log(`   Detected: ${detected}`);
    console.log(`   Sample: ${sample.substring(0, 60)}...`);

    try {
      const parsed = await parseLogsByFormat(buffer, detected);
      console.log(`   Parsed entries: ${parsed.length}`);
      if (parsed.length > 0) {
        console.log(`   First entry:`, JSON.stringify(parsed[0], null, 2));
      }
    } catch (e) {
      console.log(`   Parsing error: ${e.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ AMÉLIORATION 5 test suite completed!\n');
}

runTests().catch(console.error);
