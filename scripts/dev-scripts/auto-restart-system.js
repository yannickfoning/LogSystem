import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { PROJECT_ROOT } from '../project-root.js';

dotenv.config();

const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const MONITOR_LOG = path.join(LOG_DIR, 'server-monitor.log');

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4',
  multipleStatements: true
};

class AutoRestartSystem {
  constructor() {
    this.serverProcess = null;
    this.restartCount = 0;
    this.maxRestarts = 10;
    this.isRunning = false;
    this.lastRestart = Date.now();
  }

  async log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    console.log(logEntry);
    
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(MONITOR_LOG, logEntry + '\n');
  }

  async killExistingProcesses() {
    return new Promise((resolve) => {
      this.log('Arrêt des processus Node.js existants...');
      exec('taskkill /F /IM node.exe', (error, stdout, stderr) => {
        if (error) {
          this.log('Aucun processus Node.js à arrêter', 'info');
        } else {
          this.log('Processus Node.js arrêtés', 'info');
        }
        setTimeout(resolve, 2000); // Attendre 2 secondes
      });
    });
  }

  async checkDatabase() {
    try {
      const connection = await mysql.createConnection(dbConfig);
      await connection.execute('SELECT 1');
      await connection.end();
      this.log('Base de données accessible', 'info');
      return true;
    } catch (error) {
      this.log(`Erreur base de données: ${error.message}`, 'error');
      return false;
    }
  }

  async ensureTestData() {
    try {
      const connection = await mysql.createConnection(dbConfig);
      
      // Vérifier s'il y a des logs
      const [count] = await connection.execute('SELECT COUNT(*) as cnt FROM logs');
      
      if (count[0].cnt === 0) {
        this.log('Création de logs de test...', 'info');
        
        const testLogs = [
          ['INFO', 'system', 'monitoring', 'Platform auto-restarted'],
          ['INFO', 'system', 'monitoring', 'Database connection verified'],
          ['WARNING', 'system', 'monitoring', 'Auto-restart system active'],
          ['INFO', 'system', 'monitoring', 'Platform ready for use']
        ];
        
        for (const [level, source, service, message] of testLogs) {
          await connection.execute(`
            INSERT INTO logs (timestamp, log_level, source, service, message, normalized_message, event_type, fingerprint)
            VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)
          `, [level, source, service, message, message, 'system', 'auto_' + Date.now()]);
        }
        
        this.log('Logs de test créés', 'success');
      }
      
      await connection.end();
      return true;
    } catch (error) {
      this.log(`Erreur création logs: ${error.message}`, 'error');
      return false;
    }
  }

  async startServer() {
    if (this.isRunning) {
      this.log('Serveur déjà en cours de démarrage...', 'warning');
      return;
    }

    this.isRunning = true;
    this.restartCount++;
    
    if (this.restartCount > this.maxRestarts) {
      this.log(`Nombre maximum de redémarrages atteint (${this.maxRestarts})`, 'error');
      this.log('Arrêt du système de surveillance', 'error');
      process.exit(1);
    }

    this.log(`Démarrage du serveur (tentative ${this.restartCount}/${this.maxRestarts})`, 'info');

    // Vérifier la base de données
    const dbOk = await this.checkDatabase();
    if (!dbOk) {
      this.log('Base de données inaccessible, attente...', 'warning');
      setTimeout(() => this.startServer(), 5000);
      this.isRunning = false;
      return;
    }

    // Assurer les données de test
    await this.ensureTestData();

    // Démarrer le serveur
    this.serverProcess = spawn('npm', ['run', 'dev'], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_ENV: 'development' }
    });

    this.serverProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        this.log(`[SERVER] ${output}`, 'info');
      }
    });

    this.serverProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        this.log(`[ERROR] ${output}`, 'error');
      }
    });

    this.serverProcess.on('close', (code) => {
      this.log(`Serveur arrêté (code: ${code})`, 'warning');
      this.isRunning = false;
      
      if (code !== 0) {
        this.log('Redémarrage automatique dans 5 secondes...', 'info');
        setTimeout(() => this.startServer(), 5000);
      }
    });

    this.serverProcess.on('error', (error) => {
      this.log(`Erreur serveur: ${error.message}`, 'error');
      this.isRunning = false;
      setTimeout(() => this.startServer(), 5000);
    });

    // Vérifier que le serveur démarre correctement
    setTimeout(async () => {
      try {
        const response = await fetch('http://localhost:3001/api/dashboard/summary');
        if (response.ok) {
          this.log('Serveur fonctionnel!', 'success');
          this.restartCount = 0; // Réinitialiser le compteur
        } else {
          this.log('Serveur répond mais avec erreur', 'warning');
        }
      } catch (e) {
        this.log(`Serveur inaccessible: ${e.message}`, 'error');
        // Tuer le processus et redémarrer
        if (this.serverProcess) {
          this.serverProcess.kill();
        }
      }
    }, 10000);
  }

  async start() {
    this.log('=== DÉMARRAGE SYSTÈME DE SURVEILLANCE AUTOMATIQUE ===', 'info');
    
    // Nettoyer les processus existants
    await this.killExistingProcesses();
    
    // Démarrer le serveur
    await this.startServer();
    
    // Surveillance continue
    setInterval(async () => {
      if (!this.isRunning && this.serverProcess === null) {
        this.log('Détection de serveur arrêté, redémarrage...', 'warning');
        await this.startServer();
      }
    }, 30000); // Vérifier toutes les 30 secondes
    
    this.log('Système de surveillance actif', 'success');
    this.log('🌐 Accès: http://localhost:3001/login.html', 'info');
  }

  async stop() {
    this.log('Arrêt du système de surveillance...', 'info');
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
    process.exit(0);
  }
}

// Gestion des signaux pour arrêt propre
const system = new AutoRestartSystem();

process.on('SIGINT', () => system.stop());
process.on('SIGTERM', () => system.stop());

// Démarrer le système
system.start().catch(error => {
  console.error('Erreur démarrage système:', error);
  process.exit(1);
});
