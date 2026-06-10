import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Charge les variables d'environnement depuis .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fonction pour construire les options SSL, similaire à config/database.js
function buildSslOptions() {
  if (process.env.DB_SSL === 'true') {
    const caPath = process.env.DB_SSL_CA_PATH || path.join(__dirname, 'ca.pem');
    if (fs.existsSync(caPath)) {
      return {
        ca: fs.readFileSync(caPath),
        rejectUnauthorized: true, // Toujours vérifier le certificat en production
      };
    } else {
      console.warn(`[WARN] Certificat CA non trouvé à ${caPath}. La connexion SSL sera tentée sans vérification stricte (moins sécurisé).`);
      return { rejectUnauthorized: false }; // Moins sécurisé, mais permet de tester
    }
  }
  return false; // Pas de SSL
}

async function testDbConnection() {
  let connection;
  try {
    const dbHost = process.env.DB_HOST;
    const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbName = process.env.DB_NAME;

    if (!dbHost || !dbUser || !dbPassword || !dbName) {
      console.error('❌ Erreur: Les variables DB_HOST, DB_USER, DB_PASSWORD, DB_NAME doivent être définies dans .env');
      return;
    }

    const connectionOptions = {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      ssl: buildSslOptions(),
    };

    connection = await mysql.createConnection(connectionOptions);
    console.log('✅ Connexion à la base de données Aiven MySQL réussie !');

    const [rows] = await connection.execute('SELECT NOW() as currentTime');
    console.log('Heure actuelle de la base de données:', rows[0].currentTime);

  } catch (err) {
    console.error('❌ Erreur de connexion à la base de données:', err.message);
    console.error('Détails:', err);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

testDbConnection();