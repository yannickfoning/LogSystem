import { spawn } from 'child_process';
import fs from 'fs';
import { PROJECT_ROOT } from '../project-root.js';

console.log('🔄 Redémarrage du serveur pour appliquer les corrections...');

// Tuer les processus Node.js existants
const killProcess = spawn('taskkill', ['/F', '/IM', 'node.exe'], { shell: true });

killProcess.on('close', (code) => {
  console.log('✅ Processus Node.js arrêtés');
  
  // Attendre 2 secondes
  setTimeout(() => {
    console.log('🚀 Démarrage du serveur...');
    
    // Démarrer le serveur
    const server = spawn('npm', ['run', 'dev'], {
      shell: true,
      stdio: 'inherit',
      cwd: PROJECT_ROOT
    });
    
    server.on('error', (error) => {
      console.error('❌ Erreur démarrage:', error.message);
    });
    
    console.log('✅ Serveur en cours de démarrage...');
    console.log('🌐 Accès: http://localhost:3001/login.html');
    console.log('⏱️  Attendez 10-15 secondes pour le démarrage complet');
    
  }, 2000);
});

killProcess.on('error', (error) => {
  console.error('❌ Erreur arrêt:', error.message);
});
