#!/usr/bin/env node
/**
 * Production Audit Script for LogSystem
 * Performs comprehensive system checks before production deployment
 */

import pool from '../../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIT_RESULTS = {
  database: { status: 'pending', issues: [], fixes: [] },
  security: { status: 'pending', issues: [], fixes: [] },
  performance: { status: 'pending', issues: [], fixes: [] },
  vercel: { status: 'pending', issues: [], fixes: [] },
  logs: { status: 'pending', issues: [], fixes: [] },
  watchlogs: { status: 'pending', issues: [], fixes: [] }
};

async function auditDatabase() {
  console.log('\n=== AUDIT BASE DE DONNÉES ===');
  AUDIT_RESULTS.database.status = 'running';
  
  try {
    // Check required columns
    const requiredColumns = [
      'event_timestamp',
      'source_system', 
      'main_service',
      'hostname',
      'log_origin',
      'imported_at',
      'timestamp'
    ];
    
    const [columns] = await pool.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs'
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    for (const col of requiredColumns) {
      if (!existingColumns.includes(col)) {
        AUDIT_RESULTS.database.issues.push(`Colonne manquante: logs.${col}`);
      }
    }
    
    // Check indexes
    const requiredIndexes = [
      'idx_logs_event_timestamp',
      'idx_logs_source_system',
      'idx_logs_main_service',
      'idx_logs_hostname',
      'idx_logs_log_origin'
    ];
    
    const [indexes] = await pool.execute(`
      SHOW INDEX FROM logs WHERE Key_name IN (${requiredIndexes.map(() => '?').join(',')})
    `, requiredIndexes);
    
    const existingIndexes = [...new Set(indexes.map(i => i.Key_name))];
    
    for (const idx of requiredIndexes) {
      if (!existingIndexes.includes(idx)) {
        AUDIT_RESULTS.database.issues.push(`Index manquant: ${idx}`);
      }
    }
    
    // Check for orphaned logs
    const [orphaned] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM logs WHERE user_id IS NULL
    `);
    
    if (orphaned[0].cnt > 0) {
      AUDIT_RESULTS.database.issues.push(`${orphaned[0].cnt} logs orphelins (user_id = NULL) détectés`);
    }
    
    // Check for duplicate fingerprints
    const [duplicates] = await pool.execute(`
      SELECT fingerprint, COUNT(*) as cnt FROM logs 
      WHERE fingerprint IS NOT NULL 
      GROUP BY fingerprint HAVING cnt > 1 LIMIT 10
    `);
    
    if (duplicates.length > 0) {
      AUDIT_RESULTS.database.issues.push(`${duplicates.length} fingerprints avec duplicatas détectés`);
    }
    
    if (AUDIT_RESULTS.database.issues.length === 0) {
      AUDIT_RESULTS.database.status = 'passed';
      console.log('✓ Base de données: OK');
    } else {
      AUDIT_RESULTS.database.status = 'failed';
      console.log(`✗ Base de données: ${AUDIT_RESULTS.database.issues.length} problèmes`);
      AUDIT_RESULTS.database.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
  } catch (error) {
    AUDIT_RESULTS.database.status = 'error';
    AUDIT_RESULTS.database.issues.push(`Erreur audit base de données: ${error.message}`);
    console.log(`✗ Base de données: ERREUR - ${error.message}`);
  }
}

async function auditSecurity() {
  console.log('\n=== AUDIT SÉCURITÉ ===');
  AUDIT_RESULTS.security.status = 'running';
  
  const envVars = [
    'SESSION_SECRET',
    'CSRF_SECRET',
    'DB_PASSWORD'
  ];
  
  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (!value) {
      AUDIT_RESULTS.security.issues.push(`Variable d'environnement manquante: ${envVar}`);
    } else if (value.length < 32) {
      AUDIT_RESULTS.security.issues.push(`Variable d'environnement trop courte: ${envVar} (${value.length} < 32)`);
    }
  }
  
  // Check for admin users
  try {
    const [admins] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND is_active = 1
    `);
    
    if (admins[0].cnt === 0) {
      AUDIT_RESULTS.security.issues.push('Aucun utilisateur admin actif détecté');
    }
  } catch (error) {
    AUDIT_RESULTS.security.issues.push(`Erreur vérification admins: ${error.message}`);
  }
  
  if (AUDIT_RESULTS.security.issues.length === 0) {
    AUDIT_RESULTS.security.status = 'passed';
    console.log('✓ Sécurité: OK');
  } else {
    AUDIT_RESULTS.security.status = 'failed';
    console.log(`✗ Sécurité: ${AUDIT_RESULTS.security.issues.length} problèmes`);
    AUDIT_RESULTS.security.issues.forEach(issue => console.log(`  - ${issue}`));
  }
}

async function auditPerformance() {
  console.log('\n=== AUDIT PERFORMANCE ===');
  AUDIT_RESULTS.performance.status = 'running';
  
  try {
    // Check for slow queries indicators
    const [slowQueryLog] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM logs 
      WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    
    console.log(`  - Logs des 7 derniers jours: ${slowQueryLog[0].cnt}`);
    
    // Check table size
    const [tableSize] = await pool.execute(`
      SELECT 
        table_name,
        ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'logs'
    `);
    
    if (tableSize.length > 0) {
      console.log(`  - Taille table logs: ${tableSize[0].size_mb} MB`);
      
      if (tableSize[0].size_mb > 1000) {
        AUDIT_RESULTS.performance.issues.push(`Table logs volumineuse: ${tableSize[0].size_mb} MB`);
      }
    }
    
    if (AUDIT_RESULTS.performance.issues.length === 0) {
      AUDIT_RESULTS.performance.status = 'passed';
      console.log('✓ Performance: OK');
    } else {
      AUDIT_RESULTS.performance.status = 'warning';
      console.log(`⚠ Performance: ${AUDIT_RESULTS.performance.issues.length} avertissements`);
      AUDIT_RESULTS.performance.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
  } catch (error) {
    AUDIT_RESULTS.performance.status = 'error';
    AUDIT_RESULTS.performance.issues.push(`Erreur audit performance: ${error.message}`);
    console.log(`✗ Performance: ERREUR - ${error.message}`);
  }
}

async function auditVercel() {
  console.log('\n=== AUDIT VERCEL ===');
  AUDIT_RESULTS.vercel.status = 'running';
  
  const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  
  if (isVercel) {
    console.log('  - Environnement Vercel détecté');
    
    // Check for incompatible features
    const hasFileWatcher = process.env.WATCH_DIRS && process.env.WATCH_DIRS !== './logs';
    const hasBackgroundJobs = process.env.START_BACKGROUND_JOBS === 'true';
    
    if (hasFileWatcher) {
      AUDIT_RESULTS.vercel.issues.push('File watcher actif sur Vercel (incompatible)');
    }
    
    if (hasBackgroundJobs) {
      AUDIT_RESULTS.vercel.issues.push('Background jobs actifs sur Vercel (incompatible)');
    }
    
  } else {
    console.log('  - Environnement local/dédié');
  }
  
  // Check vercel.json configuration
  const vercelConfigPath = path.join(__dirname, '../../vercel.json');
  if (fs.existsSync(vercelConfigPath)) {
    console.log('  - Configuration vercel.json présente');
  } else {
    AUDIT_RESULTS.vercel.issues.push('Configuration vercel.json manquante');
  }
  
  if (AUDIT_RESULTS.vercel.issues.length === 0) {
    AUDIT_RESULTS.vercel.status = 'passed';
    console.log('✓ Vercel: OK');
  } else {
    AUDIT_RESULTS.vercel.status = 'failed';
    console.log(`✗ Vercel: ${AUDIT_RESULTS.vercel.issues.length} problèmes`);
    AUDIT_RESULTS.vercel.issues.forEach(issue => console.log(`  - ${issue}`));
  }
}

async function auditLogsMetadata() {
  console.log('\n=== AUDIT METADONNÉES LOGS ===');
  AUDIT_RESULTS.logs.status = 'running';
  
  try {
    // Check event_timestamp population
    const [missingEventTs] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM logs 
      WHERE event_timestamp IS NULL AND timestamp IS NOT NULL
    `);
    
    if (missingEventTs[0].cnt > 0) {
      AUDIT_RESULTS.logs.issues.push(`${missingEventTs[0].cnt} logs sans event_timestamp (peuvent être backfillés)`);
    }
    
    // Check source_system population
    const [missingSourceSystem] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM logs 
      WHERE source_system IS NULL AND (source IS NOT NULL OR source_server IS NOT NULL)
    `);
    
    if (missingSourceSystem[0].cnt > 0) {
      AUDIT_RESULTS.logs.issues.push(`${missingSourceSystem[0].cnt} logs sans source_system`);
    }
    
    // Check main_service population
    const [missingMainService] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM logs 
      WHERE main_service IS NULL AND service IS NOT NULL
    `);
    
    if (missingMainService[0].cnt > 0) {
      AUDIT_RESULTS.logs.issues.push(`${missingMainService[0].cnt} logs sans main_service`);
    }
    
    // Check hostname population
    const [missingHostname] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM logs 
      WHERE hostname IS NULL AND (source_server IS NOT NULL OR source IS NOT NULL)
    `);
    
    if (missingHostname[0].cnt > 0) {
      AUDIT_RESULTS.logs.issues.push(`${missingHostname[0].cnt} logs sans hostname`);
    }
    
    // Check log_origin population
    const [missingLogOrigin] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM logs 
      WHERE log_origin IS NULL
    `);
    
    if (missingLogOrigin[0].cnt > 0) {
      AUDIT_RESULTS.logs.issues.push(`${missingLogOrigin[0].cnt} logs sans log_origin`);
    }
    
    if (AUDIT_RESULTS.logs.issues.length === 0) {
      AUDIT_RESULTS.logs.status = 'passed';
      console.log('✓ Métadonnées logs: OK');
    } else {
      AUDIT_RESULTS.logs.status = 'warning';
      console.log(`⚠ Métadonnées logs: ${AUDIT_RESULTS.logs.issues.length} avertissements`);
      AUDIT_RESULTS.logs.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
  } catch (error) {
    AUDIT_RESULTS.logs.status = 'error';
    AUDIT_RESULTS.logs.issues.push(`Erreur audit métadonnées: ${error.message}`);
    console.log(`✗ Métadonnées logs: ERREUR - ${error.message}`);
  }
}

async function auditWatchLogs() {
  console.log('\n=== AUDIT WATCHLOGS ===');
  AUDIT_RESULTS.watchlogs.status = 'running';
  
  try {
    // Check watch_offsets table
    const [offsetTable] = await pool.execute(`
      SELECT COUNT(*) as cnt FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'watch_offsets'
    `);
    
    if (offsetTable[0].cnt === 0) {
      AUDIT_RESULTS.watchlogs.issues.push('Table watch_offsets manquante');
    } else {
      console.log('  - Table watch_offsets présente');
      
      const [offsetCount] = await pool.execute('SELECT COUNT(*) as cnt FROM watch_offsets');
      console.log(`  - ${offsetCount[0].cnt} fichiers surveillés`);
    }
    
    // Check for chokidar dependency
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    if (!packageJson.dependencies.chokidar) {
      AUDIT_RESULTS.watchlogs.issues.push('Dépendance chokidar manquante');
    } else {
      console.log('  - Dépendance chokidar présente');
    }
    
    // Check Vercel compatibility
    const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
    if (isVercel) {
      AUDIT_RESULTS.watchlogs.issues.push('WatchLogs utilise chokidar incompatible avec Vercel serverless');
      console.log('  - Mode fallback polling activé sur Vercel');
    } else {
      console.log('  - Mode file watching actif (non-Vercel)');
    }
    
    if (AUDIT_RESULTS.watchlogs.issues.length === 0) {
      AUDIT_RESULTS.watchlogs.status = 'passed';
      console.log('✓ WatchLogs: OK');
    } else {
      AUDIT_RESULTS.watchlogs.status = 'warning';
      console.log(`⚠ WatchLogs: ${AUDIT_RESULTS.watchlogs.issues.length} avertissements`);
      AUDIT_RESULTS.watchlogs.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
  } catch (error) {
    AUDIT_RESULTS.watchlogs.status = 'error';
    AUDIT_RESULTS.watchlogs.issues.push(`Erreur audit WatchLogs: ${error.message}`);
    console.log(`✗ WatchLogs: ERREUR - ${error.message}`);
  }
}

async function runAudit() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     LOGSYSTEM - AUDIT PRODUCTION                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  await auditDatabase();
  await auditSecurity();
  await auditPerformance();
  await auditVercel();
  await auditLogsMetadata();
  await auditWatchLogs();
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     RÉSUMÉ AUDIT                                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const categories = Object.keys(AUDIT_RESULTS);
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let errors = 0;
  
  for (const cat of categories) {
    const status = AUDIT_RESULTS[cat].status;
    const icon = status === 'passed' ? '✓' : status === 'warning' ? '⚠' : '✗';
    console.log(`${icon} ${cat.padEnd(15)}: ${status.toUpperCase().padEnd(10)} (${AUDIT_RESULTS[cat].issues.length} problèmes)`);
    
    if (status === 'passed') passed++;
    else if (status === 'warning') warnings++;
    else if (status === 'failed') failed++;
    else if (status === 'error') errors++;
  }
  
  console.log(`\nTotal: ${passed} OK, ${warnings} avertissements, ${failed} échecs, ${errors} erreurs`);
  
  if (failed > 0 || errors > 0) {
    console.log('\n⚠ ACTION REQUISE: Corriger les problèmes avant mise en production');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('\n⚠ AVERTISSEMENTS: Réviser les avertissements avant mise en production');
    process.exit(0);
  } else {
    console.log('\n✓ SYSTÈME PRÊT POUR LA PRODUCTION');
    process.exit(0);
  }
}

runAudit().catch(error => {
  console.error('Erreur fatale audit:', error);
  process.exit(1);
});
