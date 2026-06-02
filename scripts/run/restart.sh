#!/bin/bash
# Script de redémarrage automatique
echo "🔄 Redémarrage de LogSystem..."

# Arrêter les processus Node.js
pkill -f "node server.js"

# Attendre 2 secondes
sleep 2

# Redémarrer le serveur (racine du projet)
cd "$(dirname "$0")/../.."
npm run dev

echo "✅ LogSystem redémarré"
