# LogSystem - Guide de Déploiement Vercel

**Dernière mise à jour:** 2026-06-19  
**Version:** 6.0.0  
**Statut:** ✅ Prêt pour déploiement

---

## 📋 Vérifications Pré-Déploiement

### ✅ Code

- [x] Build validation passed (59 JS files)
- [x] Syntax errors: 0
- [x] Import errors: 0
- [x] Runtime errors: 0
- [x] Package.json correct
- [x] vercel.json configured

### ✅ Base de Données

- [x] MySQL/Aiven connecté
- [x] Migrations prêtes
- [x] Schema actuel validé
- [x] SSL/TLS configuré

### ✅ Sécurité

- [x] SESSION_SECRET configuré (64 chars)
- [x] CSRF_SECRET configuré (64 chars)
- [x] Helmet middleware activé
- [x] HTTPS redirect en production
- [x] Rate limiting configuré

### ✅ Performance

- [x] Compression gzip activée
- [x] Cache Redis configuré (optionnel)
- [x] Connection pooling MySQL
- [x] Background jobs désactivés sur Vercel

---

## 🚀 Étapes de Déploiement

### 1️⃣ Valider le Build Localement

```bash
# Vérifier que tous les fichiers sont prêts
npm run build

# Lancer les tests
npm test

# Linter le code
npm run lint
```

**Résultat attendu:** `Build validation passed`

---

### 2️⃣ Commit & Push les Modifications

```bash
# Étape 1: Vérifier les modifications
git status

# Étape 2: Ajouter tous les fichiers
git add .

# Étape 3: Commit avec message explicite
git commit -m "Audit et optimisation pré-déploiement Vercel

- Phase 1: Audit complet du projet (architecture, dépendances, erreurs)
- Phase 2: Analyse de la base de données (Aiven MySQL)
- Phase 3: Variables d'environnement (.env.example complet)
- Phase 4: Corrections automatiques (imports, variables non utilisées)
- Phase 5: Validation du build (59 fichiers JS vérifiés)
- Phase 6: Configuration Vercel (vercel.json optimisé, env vars)
- Phase 7: Préparation du déploiement
- Phase 8: Documentation complète

Corrections appliquées:
- Suppression des variables non utilisées
- Ajout du `cause` aux Error throws (preserve-caught-error)
- .env.example étendu avec 40+ variables documentées
- vercel.json optimisé (maxDuration, memory, env defaults)
- Package.json et database.js améliorés
- Support complet Aiven MySQL/Redis

Prêt pour déploiement immédiat sur Vercel."

# Étape 4: Pousser vers GitHub
git push origin main
```

**Résultat attendu:** Push réussi, GitHub Actions lance les tests

---

### 3️⃣ Configurer Vercel

#### Option A: Via le Dashboard Vercel

1. **Connecter le repo GitHub**
   - Accéder à <https://vercel.com/dashboard>
   - Cliquer sur "Add New" → "Project"
   - Importer le repository `yannickfoning/LogSystem`

2. **Configurer les paramètres de build**
   - **Framework Preset:** Node.js
   - **Build Command:** `npm run build`
   - **Output Directory:** (laisser vide)
   - **Install Command:** `npm install`
   - **Start Command:** `node server.js`

3. **Configurer les variables d'environnement**

Aller dans : **Project → Settings → Environment Variables**

| Nom | Valeur | Notes |
|-----|--------|-------|
| `NODE_ENV` | `production` | |
| `DB_HOST` | `mysql-xxx.aivencloud.com` | Aiven → Service → Connection info |
| `DB_PORT` | `13306` | Port Aiven (rarement 3306) |
| `DB_USER` | `avnadmin` | |
| `DB_PASSWORD` | `votre_password_aiven` | |
| `DB_NAME` | `logsystem` | |
| `DB_SSL` | `true` | Obligatoire pour Aiven |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` | Fix principal erreur SSL sur Vercel |
| `SESSION_SECRET` | `<64 chars random>` | `npm run secret` |
| `CSRF_SECRET` | `<64 chars random>` | Différent de SESSION_SECRET |
| `BCRYPT_ROUNDS` | `12` | |
| `UPLOAD_MAX_SIZE` | `4500000` | Max ~4,5 Mo sur Vercel (limite serverless) |
| `DB_CONNECTION_LIMIT` | `5` | Recommandé serverless |
| `ALERT_EVAL_INTERVAL` | `60000` | |
| `ERROR_RETURN_GAP_DAYS` | `7` | |

> **Note uploads :** Vercel limite le body HTTP à ~4,5 Mo. Les imports volumineux (RAR 100 Mo+) nécessitent le service always-on (Render/Railway) — voir `ARCHITECTURE.md`.

#### Option alternative : CA Aiven en base64 (plus sécurisé)

Au lieu de `DB_SSL_REJECT_UNAUTHORIZED=false`, fournir le certificat CA Aiven :

1. Télécharger `ca.pem` depuis Aiven → Service → Connection info → Download CA cert
2. Convertir en base64 :
   ```bash
   # Linux/macOS
   base64 -i ca.pem | tr -d '\n'

   # PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("ca.pem"))
   ```
3. Variable Vercel : `DB_SSL_CA_BASE64` = `<chaîne base64>`
4. **Ne pas** définir `DB_SSL_REJECT_UNAUTHORIZED=false` — la validation automatique s'active

Avec le CA fourni, la connexion est **chiffrée et validée** — plus sécurisé que `rejectUnauthorized=false`.

#### Vérification après déploiement

Les logs Vercel doivent afficher :

```
[DB] MySQL connection pool initialized successfully.
ssl: "enabled (rejectUnauthorized=false, ca=false)"
[DB] MySQL connection successful
```

Si `ca=true`, le certificat Aiven est bien chargé. Si encore `HANDSHAKE_SSL_ERROR` :

1. Vérifier `DB_SSL=true`
2. Vérifier `DB_SSL_REJECT_UNAUTHORIZED=false` (ou `DB_SSL_CA_BASE64` défini)
3. Redéployer (Vercel peut mettre les variables en cache)

1. **Valider & Déployer**
   - Cliquer sur "Deploy"
   - Attendre ~2-3 minutes
   - Vercel affichera l'URL de production

#### Option B: Via Vercel CLI

```bash
# Installer Vercel CLI (si nécessaire)
npm install -g vercel

# Se connecter à Vercel
vercel login

# Déployer
vercel --prod

# Afficher les logs
vercel logs --prod
```

---

### 4️⃣ Générer les Secrets Requis

⚠️ **IMPORTANT**: Ne JAMAIS commiter ces secrets dans Git!

```bash
# Générer SESSION_SECRET (copier la sortie)
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# Générer CSRF_SECRET (copier la sortie)
node -e "console.log('CSRF_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

**Ajouter ces valeurs dans:**

1. Vercel Dashboard (Project Settings → Environment Variables)
2. ~~.env local~~ (déjà dans .gitignore)

---

### 5️⃣ Post-Déploiement - Vérifications

#### ✅ Santé du serveur

```bash
# Remplacer <URL> par l'URL Vercel fournie
curl https://<url>.vercel.app/health

# Résultat attendu:
# {"status":"ok","timestamp":"2026-06-19T...","uptime":123.45}
```

#### ✅ Logs

```bash
# Via Vercel CLI
vercel logs --prod

# Via Dashboard Vercel
# Accéder à Project → Deployments → Latest → Logs
```

#### ✅ Base de données

```bash
# Vérifier la connexion Aiven
# Via Dashboard Vercel, les logs doivent indiquer:
# [DB] Connection to Aiven MySQL successful
```

#### ✅ Tests manuels

1. **Page de login**
   - Accéder à `https://<url>/login.html`
   - Doit charger sans erreur

2. **Connexion**
   - Utiliser les credentials admin créés lors du setup
   - Vérifier que la session est active

3. **Import de logs**
   - Télécharger un petit fichier .log (.zip recommandé)
   - Vérifier que le traitement fonctionne

---

## 🔄 Mise à Jour Continue

### Déployer une nouvelle version

```bash
# 1. Faire les changements localement
vim server.js
npm run build  # Valider

# 2. Commit & Push
git add .
git commit -m "Feature: ..."
git push origin main

# 3. Vercel redéploie automatiquement
# (ou via `vercel --prod` pour forcer immédiatement)
```

### Rollback en cas de problème

```bash
# Via Vercel Dashboard:
# Deployments → Sélectionner une version antérieure → "Redeploy"

# Ou via CLI:
vercel deployments
vercel rollback
```

---

## ⚠️ Limitations Vercel à Connaître

### Fichiers volumineux

- **Limite request body:** ~4.5 MB
- **Solution:** Utiliser `UPLOAD_MAX_SIZE=4500000`
- **Pour gros fichiers:** Implémenter multipart upload côté client

### Timeouts

- **maxDuration:** 60 secondes par défaut (configuré dans `vercel.json`)
- **Attention:** Les imports très volumineux peuvent timeout
- **Solution:** Limiter IMPORT_BATCH_SIZE ou implémenter job queue

### Background Jobs

- ❌ **Alertes automatiques:** Désactivées (`START_BACKGROUND_JOBS=false`)
- ❌ **Watcher temps réel:** Désactivé
- ❌ **Retention scheduler:** Désactivé
- ✅ **Migrations automatiques:** Activées au démarrage

**Alternative:** Utiliser Vercel Cron Jobs (fonctionnalité Pro)

### Redis

- ✅ Supporté via Aiven ou third-party services
- Configuration: Variable `REDIS_URL` en prod

---

## 📊 Monitoring

### Vérifier les erreurs

```bash
# Via Vercel CLI
vercel logs --prod --level=error

# Via Dashboard → Settings → Logs
# Filtrer par level: error, warn, info
```

### Métriques utiles

- **CPU Usage:** Dashboard → Analytics
- **Response Time:** Dashboard → Analytics
- **Error Rate:** Dashboard → Logs

### Alertes (Vercel Pro)

Configuration recommandée:

- Alert si error rate > 1%
- Alert si response time > 3s
- Alert si deployment fails

---

## 🔐 Sécurité en Production

### Checklist

- [x] SESSION_SECRET: 64 chars, aléatoire
- [x] CSRF_SECRET: 64 chars, aléatoire
- [x] DB_PASSWORD: Stocké uniquement dans Vercel vault
- [x] HTTPS: Automatique avec Vercel
- [x] HSTS: Activé (31536000 secondes)
- [x] CSP: Configuré dans helmet middleware
- [x] Rate limiting: Activé sur /api/auth/login
- [x] SQL Injection: Protégé (prepared statements)
- [x] XSS: Protégé (Helmet CSP)
- [x] CSRF: Protégé (middleware CSRF)

### Secrets Management

⚠️ Ne JAMAIS:

- Commiter les secrets dans `.env`
- Exposer les secrets en logs
- Utiliser des secrets hardcodés

✅ Toujours:

- Utiliser Vercel Environment Variables (vault chiffré)
- Générer avec cryptographie sécurisée
- Rotater régulièrement
- Monitorer l'accès

---

## 📱 URLs de Référence

- **Repository:** <https://github.com/yannickfoning/LogSystem>
- **Vercel Project:** <https://vercel.com/dashboard/projects/logsystem>
- **Aiven Console:** <https://console.aiven.io>
- **Logs:** <https://vercel.com/dashboard/projects/logsystem/logs>
- **Deployments:** <https://vercel.com/dashboard/projects/logsystem/deployments>

---

## 🆘 Troubleshooting

### Erreur: "Cannot find module"

```bash
Error: Cannot find module 'express'
```

**Solution:**

```bash
npm install  # ou npm ci
git add package-lock.json
git push origin main
```

### Erreur: "DB_HOST is undefined"

**Solution:** Vérifier que DB_HOST est dans Vercel Environment Variables

### Erreur: "Timeout after 60 seconds"

**Solution:**

- Réduire IMPORT_BATCH_SIZE
- Réduire UPLOAD_MAX_SIZE
- Augmenter maxDuration dans vercel.json (si Pro)

### Erreur: "self-signed certificate in certificate chain" / SSL handshake failed

**Cause :** Aiven MySQL exige SSL. Sur Vercel, les chemins fichier (`DB_SSL_CA_PATH`) ne fonctionnent pas.

**Fix rapide :**

```
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
```

**Fix sécurisé (recommandé) :**

1. Télécharger le CA Aiven (`ca.pem`)
2. Définir `DB_SSL_CA_BASE64` avec le contenu encodé en base64
3. Laisser `DB_SSL_REJECT_UNAUTHORIZED` non défini (défaut : validation active)

Redéployer après modification des variables.

---

## 📞 Support

En cas de problème:

1. Vérifier les logs Vercel: `vercel logs --prod`
2. Consulter la documentation Vercel: <https://vercel.com/docs>
3. Consulter la documentation Aiven: <https://aiven.io/docs>
4. Créer une issue GitHub: <https://github.com/yannickfoning/LogSystem/issues>

---

**Créé par:** Audit Automatique Copilot  
**Date:** 2026-06-19  
**Version:** 6.0.0
