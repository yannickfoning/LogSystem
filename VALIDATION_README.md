# Validation LogSystem - Guide Rapide

## Outils de Validation

### 1. Smoke Test (Validation Rapide)

**Quand l'utiliser** :
- Après un redémarrage du serveur
- Avant un déploiement
- Pour vérifier rapidement que le service est sain
- Après une modification mineure

**Comment l'exécuter** :
```bash
npm run smoke-test
```

**Avec environnement personnalisé** :
```bash
BASE_URL=https://votre-instance.onrender.com \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=VotreMotDePasse \
npm run smoke-test
```

**Ce qu'il teste** :
- Health endpoint
- Login admin
- Admin status
- Users list
- Retention stats
- Search API

**Durée** : ~10 secondes

**Fichier** : `scripts/smoke-test.sh`

---

### 2. Checklist Complète (Validation Production)

**Quand l'utiliser** :
- Avant un déploiement en production
- Après une modification majeure
- Pour valider l'état complet du système
- Avant toute opération de purge/rétention

**Comment l'utiliser** :
1. Ouvrir `VALIDATION_PROD_CHECKLIST.md`
2. Suivre les sections dans l'ordre :
   - Préconditions
   - Smoke test
   - Diagnostics
   - Validation manuelle
   - Purge/rétention (SEULEMENT si nécessaire)
   - Validation finale

**Ce qu'elle couvre** :
- État de l'environnement
- Validation complète des endpoints
- Tests fonctionnels via UI
- Opérations destructives avec garde-fous
- Stabilité et monitoring

**Durée** : 15-30 minutes

**Fichier** : `VALIDATION_PROD_CHECKLIST.md`

---

## Opérations Destructives

⚠️ **NE JAMAIS** exécuter de purge ou rétention sans :

1. Backup de la base de données
2. Validation du contexte avec la checklist
3. Compréhension des données concernées
4. Confirmation explicite dans l'interface

**Commandes à éviter en routine** :
- `npm run maintenance:cleanup` (purge de logs)
- `npm run maintenance:sessions` (nettoyage sessions)

---

## Commandes Utiles

```bash
# Validation rapide
npm run smoke-test

# Diagnostics complets
npm run diagnose:comprehensive

# Diagnostics individuels
npm run diagnose:alerts
npm run diagnose:admin
npm run diagnose:counts
npm run diagnose:rules

# Tests automatisés
npm test
npm run test:platform
```

---

## Résumé

| Situation | Outil |
|-----------|-------|
| Vérification rapide | `npm run smoke-test` |
| Validation production | `VALIDATION_PROD_CHECKLIST.md` |
| Diagnostics système | `npm run diagnose:comprehensive` |
| Tests unitaires | `npm test` |

---

## Fichiers à Consulter

- `scripts/smoke-test.sh` - Script de smoke test
- `scripts/SMOKE_TEST_README.md` - Documentation détaillée du smoke test
- `VALIDATION_PROD_CHECKLIST.md` - Checklist complète de production
- `VALIDATION_README.md` - Ce fichier (guide rapide)
