/**
 * Vérifier le dernier job d'import
 */
import pool from './config/database.js';

async function checkLastImport() {
  try {
    const [rows] = await pool.execute(
      `SELECT id, filename, status, total_lines, processed_lines, error_message, 
              created_at, completed_at, import_summary 
       FROM import_jobs 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    if (rows.length === 0) {
      console.log('Aucun job d\'import trouvé');
      return;
    }

    const job = rows[0];
    console.log('=== Dernier job d\'import ===');
    console.log(`ID: ${job.id}`);
    console.log(`Fichier: ${job.filename}`);
    console.log(`Statut: ${job.status}`);
    console.log(`Lignes totales: ${job.total_lines}`);
    console.log(`Lignes traitées: ${job.processed_lines}`);
    console.log(`Message d'erreur: ${job.error_message || 'Aucune'}`);
    console.log(`Créé le: ${job.created_at}`);
    console.log(`Terminé le: ${job.completed_at || 'En cours'}`);

    if (job.import_summary) {
      console.log('\n=== Résumé d\'import ===');
      const summary = JSON.parse(job.import_summary);
      console.log(JSON.stringify(summary, null, 2));
    }

  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    await pool.end();
  }
}

checkLastImport();
