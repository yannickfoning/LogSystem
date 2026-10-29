# Smoke Test LogSystem

Script de validation minimal et non-destructif pour la plateforme LogSystem.

## Objectif

Valider les fonctionnalités critiques de la plateforme sans risque de suppression de données:
- Health endpoint
- Authentification admin
- Statut système admin
- Liste utilisateurs
- Stats de rétention
- Recherche API

## Utilisation

### Via npm

```bash
# Test local (localhost:10000)
npm run smoke-test

# Test avec URL personnalisée
BASE_URL=https://mon-logsystem.onrender.com npm run smoke-test

# Test avec credentials personnalisés
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=MyPassword123 npm run smoke-test
```

### Directement

```bash
chmod +x scripts/smoke-test.sh
bash scripts/smoke-test.sh
```

## Tests Inclus

1. **Health endpoint** - Vérifie que le serveur répond
2. **Login admin** - Teste l'authentification
3. **Admin status** - Vérifie l'accès aux infos système
4. **Users list** - Teste l'accès à la liste des utilisateurs
5. **Retention stats** - Vérifie les stats de rétention (lecture seule)
6. **Search** - Teste l'API de recherche

## Résultat Attendu

```
=== SMOKE TEST LOGSYSTEM ===
URL: http://localhost:10000

1. Test /health endpoint...
✅ Health endpoint OK

2. Test login admin...
✅ Login admin OK

3. Test /api/admin/system/status...
✅ Admin status OK

4. Test /api/admin/users...
✅ Users list OK

5. Test /api/admin/retention/stats...
✅ Retention stats OK

6. Test /api/search...
✅ Search OK

=== SMOKE TEST TERMINÉ ===
✅ Tests critiques passés
```

## Caractéristiques

- **Non-destructif**: Aucune purge ou suppression de données
- **Minimal**: Teste uniquement les endpoints critiques
- **Robuste**: Gestion d'erreurs avec messages détaillés
- **Portable**: Compatible Linux/Mac/Windows (Git Bash)
- **Automatique**: Nettoyage automatique des fichiers temporaires

## En cas d'échec

Si un test échoue, le script affiche:
- Le code HTTP de l'erreur
- Le contenu de la réponse JSON
- Un message explicite

### Erreurs courantes

**Login échoue (HTTP 401)**
```bash
# Recréer l'admin
npm run create-admin
```

**Health endpoint échoue**
- Vérifier que le serveur est démarré (`npm start`)
- Vérifier le port (10000 par défaut)

**Endpoint admin échoue (HTTP 401/403)**
- Vérifier que l'admin existe
- Vérifier les credentials

## Notes

- Ce script est un **smoke test**, pas une suite de tests complète
- Il ne remplace pas les tests unitaires (`npm test`)
- Il ne remplace pas les diagnostics (`npm run diagnose:comprehensive`)
- Il est conçu pour être exécuté rapidement avant toute opération admin

## Sécurité

- Le script utilise des fichiers temporaires uniques (`mktemp`)
- Le cookie jar est nettoyé automatiquement (`trap cleanup EXIT`)
- Aucune opération destructive n'est exécutée
