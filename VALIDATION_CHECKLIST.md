# Checklist de Validation - LogSystem (Render/Aiven)

Ce guide est une checklist UI + API à copier-coller dans le navigateur et le terminal pour valider la plateforme.

## 📋 Prérequis

- **URL Render** : https://logsystem-z41e.onrender.com
- **Admin email** : admin@logsystem.local
- **Admin password** : CHANGE_ME (à modifier après première connexion)

---

## 1️⃣ Prérequis (Terminal)

```bash
cd /d/COLEPS/code/LogSystem
npm install
npm test
npm run lint
npm run diagnose:comprehensive
npm run diagnose:admin
npm run diagnose:counts
npm run diagnose:rules
```

**Validation :**
- ✅ Tous les tests passent
- ✅ Pas d'erreurs lint
- ✅ Diagnostics OK

---

## 2️⃣ Test de Santé (Terminal)

```bash
curl -i https://logsystem-z41e.onrender.com/health
```

**Validation :**
- ✅ HTTP 200
- ✅ JSON avec `status: "ok"`
- ✅ `database: "ok"`
- ✅ `uptime` présent

---

## 3️⃣ Test d'Authentification (Terminal)

```bash
# Créer admin si nécessaire
npm run create-admin

# Test login
curl -c cookies.txt -X POST https://logsystem-z41e.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@logsystem.local","password":"CHANGE_ME"}'

# Test accès sans auth
curl https://logsystem-z41e.onrender.com/api/admin/system/status
```

**Validation :**
- ✅ Login répond 200
- ✅ Accès sans auth répond 401
- ✅ Session persistante

---

## 4️⃣ Test Admin / Utilisateur (UI)

1. **Connectez-vous** sur https://logsystem-z41e.onrender.com avec admin
2. **Allez sur** Administration → Utilisateurs
3. **Testez** :
   - [ ] Lister les utilisateurs
   - [ ] Créer un utilisateur test
   - [ ] Modifier le rôle
   - [ ] Réinitialiser le mot de passe
   - [ ] Activer/désactiver l'utilisateur
   - [ ] Supprimer un utilisateur non-admin
   - [ ] Vérifier protection du dernier admin

**Validation :**
- ✅ Toutes les actions fonctionnent
- ✅ Dernier admin protégé

---

## 5️⃣ Test d'Import de Logs (UI)

1. **Allez sur** Import (📥 Importer)
2. **Importez** un petit fichier log (.log, .json, .jsonl)
3. **Vérifiez** :
   - [ ] Import en cours (progression visible)
   - [ ] Import terminé avec status `completed`
   - [ ] Compte de lignes affiché
   - [ ] Pas de doublons excessifs
   - [ ] Logs présents dans dashboard

**Validation :**
- ✅ Import fonctionne
- ✅ Données cohérentes

---

## 6️⃣ Test de Recherche et Dashboard (UI)

1. **Allez sur** Dashboard (📊 Vue d'ensemble)
2. **Vérifiez** :
   - [ ] KPIs s'affichent (total logs, erreurs, alertes)
   - [ ] Graphique de tendances s'affiche
   - [ ] Logs récents s'affichent
   - [ ] Top erreurs s'affiche

3. **Allez sur** Search (🔍 Rechercher)
4. **Testez** :
   - [ ] Recherche par mot-clé
   - [ ] Filtre par niveau (ERROR, INFO, etc.)
   - [ ] Filtre par date
   - [ ] Filtre par source/service

**Validation :**
- ✅ Dashboard affiche les données
- ✅ Recherche fonctionne
- ✅ Filtres appliqués

---

## 7️⃣ Test des Alertes (UI)

1. **Allez sur** Administration → Règles d'alerte
2. **Testez** :
   - [ ] Créer une règle d'alerte
   - [ ] Modifier une règle
   - [ ] Supprimer une règle
   - [ ] Vérifier le dashboard pour alertes

**Validation :**
- ✅ Alertes créées/modifiées/supprimées
- ✅ Alertes affichées dans dashboard

---

## 8️⃣ Test de Rétention (UI + Terminal)

**Via UI :**
1. **Allez sur** Administration → Rétention
2. **Cliquez sur** "Exécuter rétention"
3. **Vérifiez** :
   - [ ] Pas d'erreur serveur
   - [ ] Stats de rétention mises à jour
   - [ ] Compte supprimé cohérent

**Via API :**
```bash
# Stats rétention
curl -b cookies.txt https://logsystem-z41e.onrender.com/api/admin/retention/stats

# Exécuter rétention
curl -b cookies.txt -X POST https://logsystem-z41e.onrender.com/api/admin/retention/run
```

**Validation :**
- ✅ Rétention s'exécute sans erreur
- ✅ `error_groups` nettoyé proprement
- ✅ Pas de crash

---

## 9️⃣ Test de Purge Manuelle (UI + Terminal)

**Via UI :**
1. **Allez sur** Administration → Purge
2. **Testez** :
   - [ ] Purge par niveau (ex: WARNING)
   - [ ] Purge par date
   - [ ] Purge avec les deux critères
   - [ ] Purge sans critère (doit échouer)
   - [ ] Purge avec niveau invalide (doit échouer)

**Via API :**
```bash
# Purge par niveau
curl -b cookies.txt -X POST https://logsystem-z41e.onrender.com/api/admin/purge \
  -H "Content-Type: application/json" \
  -d '{"log_level":"WARNING"}'

# Purge par date
curl -b cookies.txt -X POST https://logsystem-z41e.onrender.com/api/admin/purge \
  -H "Content-Type: application/json" \
  -d '{"date_before":"2024-01-01 00:00:00"}'
```

**Validation :**
- ✅ Suppression partielle si critère valide
- ✅ Pas d'erreur SQL
- ✅ Audit log enregistré
- ✅ Retour JSON `deleted`

---

## 🔟 Test de Robustesse DB / Schéma (MySQL)

**Connectez-vous à MySQL Aiven :**
```bash
mysql -h mysql-aab9c07-yannickfoning22-33d3.d.aivencloud.com -P 21661 -u avnadmin -p
```

**Exécutez :**
```sql
SHOW TABLES;
DESCRIBE logs;
DESCRIBE error_groups;
DESCRIBE alerts;
SHOW INDEX FROM logs;
SHOW INDEX FROM error_groups;
```

**Validation :**
- ✅ Tables présentes
- ✅ Colonnes critiques présentes (`sample_log_id`, `fingerprint`, `user_id`, `timestamp`)
- ✅ Index critiques présents
- ✅ Schéma cohérent

---

## 1️⃣1️⃣ Test de Sécurité (UI)

1. **Testez** :
   - [ ] Mauvais login bloqué
   - [ ] Accès direct au dashboard sans auth bloqué
   - [ ] Logout fonctionne
   - [ ] Session persistante après reload

**Validation :**
- ✅ Sécurité OK

---

## 1️⃣2️⃣ Test de Performance Légère (UI)

1. **Importez** 1000 logs
2. **Vérifiez** :
   - [ ] Temps de réponse acceptable (< 5s)
   - [ ] Dashboard charge
   - [ ] Pas de timeout sur les requêtes

**Validation :**
- ✅ Performance acceptable

---

## ✅ Checklist de Validation Finale

- [ ] `/health` répond 200
- [ ] MySQL accessible
- [ ] Admin login OK
- [ ] Dashboard accessible
- [ ] Import logs OK
- [ ] Recherche OK
- [ ] Alertes OK
- [ ] Rétention OK
- [ ] Purge OK
- [ ] Audit log OK
- [ ] Admin actions OK
- [ ] Pas de crash après purge/rétention
- [ ] Schéma DB cohérent
- [ ] Sécurité OK
- [ ] Performance OK

---

## 🎯 Ordre de Test Recommandé (Bug Actuel)

À cause du bug purge/rétention, testez dans cet ordre :

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

---

## 📝 Notes

- Pour tester automatiquement, utilisez : `./scripts/validate-platform.sh https://logsystem-z41e.onrender.com`
- Pour vérifier les logs Render : https://dashboard.render.com → service → Logs
- Pour vérifier les logs Aiven : https://aiven.io → service → Logs
