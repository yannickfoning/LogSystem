/**
 * Script de test pour diagnostiquer l'extraction RAR
 */
import { extractArchive, isArchive, detectArchiveType, filterLogFiles } from './lib/processing/archiveHandler.js';
import fs from 'fs';
import path from 'path';

const RAR_FILE = './uploads/tmp/your-rar-file.rar'; // Remplacez avec le chemin réel

async function testRarExtraction() {
  console.log('=== Test d\'extraction RAR ===\n');

  // Vérifier si le fichier existe
  if (!fs.existsSync(RAR_FILE)) {
    console.error(`❌ Fichier RAR non trouvé: ${RAR_FILE}`);
    console.log('Veuillez modifier le chemin RAR_FILE dans le script');
    process.exit(1);
  }

  const buffer = fs.readFileSync(RAR_FILE);
  const filename = path.basename(RAR_FILE);

  console.log(`📁 Fichier: ${filename}`);
  console.log(`📏 Taille: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Détection du type d'archive
  const archiveType = detectArchiveType(filename, buffer);
  console.log(`🔍 Type détecté: ${archiveType}`);

  // Vérification isArchive
  const isArch = isArchive(filename);
  console.log(`✅ isArchive(): ${isArch}`);

  if (!isArch) {
    console.error('❌ Le fichier n\'est pas reconnu comme archive!');
    process.exit(1);
  }

  // Test d'extraction
  console.log('\n🔄 Début de l\'extraction...');
  try {
    const extracted = await extractArchive(buffer, filename);
    console.log(`✅ Extraction réussie: ${extracted.length} fichiers extraits`);

    // Liste des fichiers extraits
    console.log('\n📋 Fichiers extraits:');
    for (const file of extracted) {
      console.log(`  - ${file.filename} (${(file.content.length / 1024 / 1024).toFixed(2)} MB)`);
    }

    // Filtrage des fichiers log
    const logFiles = filterLogFiles(extracted);
    console.log(`\n📝 Fichiers log après filtrage: ${logFiles.length}`);
    for (const file of logFiles) {
      console.log(`  - ${file.filename} (${(file.content.length / 1024 / 1024).toFixed(2)} MB)`);
    }

    if (logFiles.length === 0) {
      console.error('❌ Aucun fichier log trouvé après filtrage!');
      console.log('C\'est probablement le problème: les fichiers sont extraits mais filtrés incorrectement');
    } else {
      console.log('\n✅ Les fichiers log sont correctement filtrés');
    }

  } catch (error) {
    console.error('❌ Erreur lors de l\'extraction:');
    console.error(`   Code: ${error.code}`);
    console.error(`   Message: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
  }
}

testRarExtraction().catch(console.error);
