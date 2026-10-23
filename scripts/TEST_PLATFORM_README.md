# Scripts de Test Complet de la Plateforme LogSystem

Ces scripts effectuent une validation complète de la plateforme LogSystem en suivant l'ordre logique recommandé.

## Ordre de Test

1. **Santé du service** - Vérification du endpoint `/health`
2. **Base de données** - Validation du schéma et de la connectivité
3. **Authentification / Admin** - Tests de login, session, et autorisations
4. **Admin / Utilisateur** - CRUD utilisateurs et règles d'alerte
5. **Import de logs** - Validation de l'ingestion
6. **Recherche et Dashboard** - Tests des endpoints de recherche et stats
7. **Alertes** - Validation du système d'alertes
8. **Rétention** - Vérification de la configuration et stats
9. **Purge manuelle** - Tests de validation des critères de purge
10. **Robustesse DB / Schéma** - Validation de l'intégrité du schéma
11. **Sécurité** - Tests de sécurité basiques
12. **Performance légère** - Tests de performance (optionnel)

## Utilisation

### Linux/Mac (Bash)

```bash
# Usage avec les valeurs par défaut (localhost:10000)
./scripts/test-platform-complete.sh

# Avec URL personnalisée
BASE_URL=https://mon-logsystem.onrender.com ./scripts/test-platform-complete.sh

# Avec credentials personnalisés
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=MyPassword123 ./scripts/test-platform-complete.sh

# Sauter les tests npm (diagnostics déjà exécutés)
SKIP_NPM=true ./scripts/test-platform-complete.sh
```

### Windows (PowerShell)

```powershell
# Usage avec les valeurs par défaut (localhost:10000)
.\scripts\test-platform-complete.ps1

# Avec URL personnalisée
.\scripts\test-platform-complete.ps1 -BaseUrl "https://mon-logsystem.onrender.com"

# Avec credentials personnalisés
.\scripts\test-platform-complete.ps1 -AdminEmail "admin@example.com" -AdminPassword "MyPassword123"

# Sauter les tests npm (diagnostics déjà exécutés)
.\scripts\test-platform-complete.ps1 -SkipNpm
```

## Pré-requis

### Avant d'exécuter les scripts

1. **Créer l'admin par défaut** (si nécessaire):
   ```bash
   npm run create-admin
   ```

2. **Démarrer le serveur** (si test local):
   ```bash
   npm start
   # ou
   npm run dev
   ```

3. **S'assurer que MySQL est accessible**:
   - Local: MySQL doit être en cours d'exécution
   - Render/Aiven: Variables d'environnement configurées

## Tests Inclus

### Tests Préliminaires (optionnels avec -SkipNpm)
- `npm install` - Installation des dépendances
- `npm test` - Tests unitaires
- `npm run lint` - Linting du code
- `npm run diagnose:comprehensive` - Diagnostic complet
- `npm run diagnose:admin` - Diagnostic admin
- `npm run diagnose:counts` - Diagnostic des comptes
- `npm run diagnose:rules` - Diagnostic des règles

### Tests API
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

Les opérations destructives suivantes ne sont PAS exécutées automatiquement:
- Run retention (suppression de logs par date)
- Purge par niveau
- Purge par date
- Import de logs (nécessite fichier manuel)

Ces tests doivent être exécutés manuellement avec précaution.

## Résultats

À la fin de l'exécution, le script affiche:
- Nombre de tests réussis
- Nombre de tests échoués
- Total des tests
- Code de sortie: 0 si tout est OK, 1 si des tests ont échoué

## Exemple de Sortie

```
======================================================================
TESTS PRÉLIMINAIRES
======================================================================
ℹ️  Installation des dépendances...
✅ npm install
ℹ️  Exécution des tests unitaires...
✅ npm test
...

======================================================================
1. SANTÉ DU SERVICE
======================================================================
ℹ️  Test du endpoint: http://localhost:10000/health
✅ Health endpoint HTTP 200 et status ok
✅ Base de données accessible
✅ Uptime présent
...

======================================================================
RÉSUMÉ DES TESTS
======================================================================

Tests réussis: 25
Tests échoués: 2
Total tests: 27

⚠️ Certains tests ont échoué
```

## Dépannage

### Login admin échoue
```bash
# Recréer l'admin
npm run create-admin
```

### Health endpoint inaccessible
- Vérifier que le serveur est démarré
- Vérifier le port (10000 par défaut)
- Vérifier les variables d'environnement

### Erreur de connexion DB
- Vérifier les credentials MySQL
- Vérifier que MySQL est accessible
- Vérifier les variables d'environnement DB

## Ordre Prioritaire Recommandé

En cas de bug actuel (ex: purge/rétention), exécuter dans cet ordre:

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
