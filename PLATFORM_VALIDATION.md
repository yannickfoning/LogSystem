# Validation de la Plateforme LogSystem

Ce document présente les outils disponibles pour valider la plateforme LogSystem avant déploiement sur Render/Aiven.

## Outils Disponibles

### 1. Script Automatisé (Bash)

**Fichier**: `scripts/test-platform-complete.sh`

Exécute automatiquement tous les tests dans l'ordre logique:

```bash
# Usage basique
./scripts/test-platform-complete.sh

# Avec URL personnalisée
BASE_URL=https://mon-logsystem.onrender.com ./scripts/test-platform-complete.sh

# Avec credentials personnalisés
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=MyPassword123 ./scripts/test-platform-complete.sh

# Sauter les tests npm
SKIP_NPM=true ./scripts/test-platform-complete.sh
```

Ou via npm:

```bash
npm run test:platform
```

### 2. Script Automatisé (PowerShell)

**Fichier**: `scripts/test-platform-complete.ps1`

Pour Windows:

```powershell
# Usage basique
.\scripts\test-platform-complete.ps1

# Avec URL personnalisée
.\scripts\test-platform-complete.ps1 -BaseUrl "https://mon-logsystem.onrender.com"

# Avec credentials personnalisés
.\scripts\test-platform-complete.ps1 -AdminEmail "admin@example.com" -AdminPassword "MyPassword123"

# Sauter les tests npm
.\scripts\test-platform-complete.ps1 -SkipNpm
```

### 3. Checklist Manuelle (UI + API)

**Fichier**: `scripts/VALIDATION_CHECKLIST.md`

Guide étape par étape pour valider manuellement la plateforme en combinant:
- Tests dans le navigateur
- Tests dans le terminal

Idéal pour:
- Validation détaillée
- Investigation de bugs
- Tests de scénarios spécifiques

## Ordre de Test

Les tests suivent cet ordre logique:

1. **Santé du service** - `/health` endpoint
2. **Base de données** - Schéma et connectivité
3. **Authentification / Admin** - Login, session, autorisations
4. **Admin / Utilisateur** - CRUD utilisateurs, règles d'alerte
5. **Import de logs** - Ingestion de fichiers
6. **Recherche et Dashboard** - Recherche, stats, top errors
7. **Alertes** - Création, déclenchement, lecture
8. **Rétention** - Configuration, stats, exécution
9. **Purge manuelle** - Validation des critères
10. **Robustesse DB / Schéma** - Intégrité du schéma
11. **Sécurité** - Rate limit, cookies, CSRF
12. **Performance légère** - Temps de réponse

## Pré-requis

Avant d'exécuter les tests:

```bash
# 1. Installer les dépendances
npm install

# 2. Créer l'admin par défaut
npm run create-admin

# 3. Démarrer le serveur (si test local)
npm start
# ou
npm run dev
```

## Tests Inclus

### Tests Préliminaires (optionnels)
- `npm install` - Installation des dépendances
- `npm test` - Tests unitaires
- `npm run lint` - Linting du code
- `npm run diagnose:comprehensive` - Diagnostic complet
- `npm run diagnose:admin` - Diagnostic admin
- `npm run diagnose:counts` - Diagnostic des comptes
- `npm run diagnose:rules` - Diagnostic des règles

### Tests API Automatisés
- Health endpoint
- Login admin
- Mauvais mot de passe
- Accès sans auth
- Dashboard sans auth
- Liste utilisateurs
- Règles d'alerte
- Stats dashboard
- Recherche
- Top errors
- Alertes
- Stats retention
- Validation purge

### Tests de Validation
- Purge sans critère (doit échouer)
- Purge avec niveau invalide (doit échouer)
- Validation du schéma DB

## Tests Non Exécutés (Destructifs)

Les opérations destructives ne sont PAS exécutées automatiquement:
- Run retention (suppression de logs par date)
- Purge par niveau
- Purge par date
- Import de logs (nécessite fichier manuel)

Ces tests doivent être exécutés manuellement avec précaution via la checklist.

## Résultats

Les scripts affichent:
- Nombre de tests réussis
- Nombre de tests échoués
- Total des tests
- Code de sortie: 0 si OK, 1 si échec

## Documentation Complète

- **Script Bash**: `scripts/TEST_PLATFORM_README.md`
- **Checklist UI+API**: `scripts/VALIDATION_CHECKLIST.md`

## Ordre Prioritaire (en cas de bug)

Si vous investigatez un bug actuel (ex: purge/rétention), suivez cet ordre:

1. `/health`
2. Admin login
3. Purge par niveau
4. Purge par date
5. Rétention
6. Import d'un petit log
7. Recherche
8. Alertes
9. Dashboards
10. Sécurité

Cet ordre révèle le plus vite les écarts de production.

## Exemple d'Utilisation Rapide

```bash
# 1. Démarrer le serveur
npm start

# 2. Dans un autre terminal, exécuter les tests
npm run test:platform

# 3. Si des tests échouent, consulter la checklist détaillée
cat scripts/VALIDATION_CHECKLIST.md
```

## Support

En cas de problème:
1. Vérifier que le serveur est démarré
2. Vérifier que l'admin existe (`npm run create-admin`)
3. Vérifier les variables d'environnement
4. Consulter les logs du serveur
