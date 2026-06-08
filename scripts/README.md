# Scripts LogSystem

Ce dossier contient les scripts utilitaires pour le développement, la maintenance et le déploiement de LogSystem.

## Structure

```
scripts/
├── setup/              # Scripts de configuration initiale
│   ├── apply-schema.js         # Application du schema de base de données
│   ├── create-default-users.js # Création des utilisateurs par défaut
│   └── seed.js                # Peuplement de la base de données avec des données de test
├── maintenance/        # Scripts de maintenance et diagnostic
│   ├── check-create-users.js  # Vérification de la création d'utilisateurs
│   ├── check-users.js          # Vérification des utilisateurs existants
│   ├── list-tables.js          # Liste des tables de la base de données
│   └── test-format-detection.js # Test de détection de format de logs
├── tools/              # Scripts utilitaires
│   ├── create-alert-rules.js   # Création de règles d'alerte
│   ├── generate-secret.js      # Génération de secrets sécurisés
│   └── reset-user-password.js  # Réinitialisation de mot de passe utilisateur
├── run/                # Scripts de démarrage
│   ├── restart.sh              # Redémarrage du serveur (Linux/Mac)
│   └── start-server.bat        # Démarrage du serveur (Windows)
└── project-root.js     # Utilitaire pour obtenir la racine du projet
```

## Utilisation

### Setup initial

```bash
# Application du schema
node scripts/setup/apply-schema.js

# Création des utilisateurs par défaut
node scripts/setup/create-default-users.js

# Peuplement de la base de données
node scripts/setup/seed.js
```

### Maintenance

```bash
# Vérification des utilisateurs
node scripts/maintenance/check-users.js

# Liste des tables
node scripts/maintenance/list-tables.js

# Test de détection de format
node scripts/maintenance/test-format-detection.js
```

### Outils

```bash
# Génération d'un secret
node scripts/tools/generate-secret.js

# Création de règles d'alerte
node scripts/tools/create-alert-rules.js

# Réinitialisation de mot de passe
node scripts/tools/reset-user-password.js
```

### Démarrage

```bash
# Windows
.\scripts\run\start-server.bat

# Linux/Mac
bash scripts/run/restart.sh
```

## Notes

- Tous les scripts utilisent ES modules (import/export)
- Les scripts de setup doivent être exécutés dans l'ordre: apply-schema → create-default-users → seed
- Les scripts de maintenance peuvent être exécutés à tout moment pour diagnostiquer des problèmes
- Le script project-root.js est utilisé par d'autres scripts pour obtenir le chemin racine du projet
