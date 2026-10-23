# Checklist de Validation UI + API

Cette checklist peut être utilisée pour valider manuellement la plateforme LogSystem en combinant les tests dans le navigateur et le terminal.

## Pré-requis

- [ ] Serveur démarré (local ou Render)
- [ ] Admin créé (`npm run create-admin`)
- [ ] Base de données accessible

---

## 1. Santé du Service

### Terminal
```bash
curl -i http://localhost:10000/health
# ou pour Render:
curl -i https://<ton-url-render>/health
```

**Vérifications:**
- [ ] HTTP 200
- [ ] JSON avec `status: "ok"`
- [ ] `database: "ok"`
- [ ] `uptime` présent

---

## 2. Authentification

### Terminal - Login Admin
```bash
curl -c cookies.txt -X POST http://localhost:10000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@logsystem.local","password":"CHANGE_ME"}'
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Cookies générés (connect.sid, csrf_token)

### Terminal - Mauvais Mot de Passe
```bash
curl -X POST http://localhost:10000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@logsystem.local","password":"wrongpassword"}'
```

**Vérifications:**
- [ ] HTTP 401
- [ ] Message d'erreur approprié

### Navigateur - Accès Sans Auth
Ouvrir dans le navigateur:
- `http://localhost:10000/dashboard.html`
- `http://localhost:10000/admin.html`

**Vérifications:**
- [ ] Redirection vers `/login.html`
- [ ] Message d'erreur visible

### Navigateur - Login avec Bon Credentials
1. Ouvrir `http://localhost:10000/login.html`
2. Entrer: `admin@logsystem.local` / `CHANGE_ME`
3. Cliquer sur "Connexion"

**Vérifications:**
- [ ] Redirection vers `/dashboard.html`
- [ ] Session persistante
- [ ] Menu admin visible

### Navigateur - Logout
1. Cliquer sur "Déconnexion"
2. Essayer d'accéder à `/dashboard.html`

**Vérifications:**
- [ ] Redirection vers login
- [ ] Session détruite

---

## 3. Admin / Utilisateur

### Terminal - Liste Utilisateurs
```bash
curl -b cookies.txt http://localhost:10000/api/admin/users
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Liste d'utilisateurs retournée
- [ ] Admin présent

### Navigateur - Création Utilisateur
1. Ouvrir `/admin.html` → Utilisateurs
2. Cliquer sur "Ajouter un utilisateur"
3. Remplir le formulaire
4. Sauvegarder

**Vérifications:**
- [ ] Utilisateur créé
- [ ] Notification de succès
- [ ] Utilisateur visible dans la liste

### Navigateur - Modification Rôle
1. Sélectionner un utilisateur
2. Changer le rôle (User → Admin)
3. Sauvegarder

**Vérifications:**
- [ ] Rôle modifié
- [ ] Notification de succès

### Navigateur - Réinitialisation Mot de Passe
1. Sélectionner un utilisateur
2. Cliquer "Réinitialiser mot de passe"
3. Vérifier le nouveau mot de passe

**Vérifications:**
- [ ] Mot de passe réinitialisé
- [ ] Notification avec nouveau mot de passe

### Navigateur - Protection Dernier Admin
1. Essayer de supprimer le dernier admin
2. Essayer de désactiver le dernier admin

**Vérifications:**
- [ ] Suppression bloquée
- [ ] Désactivation bloquée
- [ ] Message d'erreur explicite

---

## 4. Import de Logs

### Navigateur - Import via UI
1. Ouvrir `/dashboard.html`
2. Cliquer "Importer des logs"
3. Choisir un petit fichier .log (ex: 100 lignes)
4. Lancer l'import

**Vérifications:**
- [ ] Barre de progression visible
- [ ] Import se termine avec succès
- [ ] Nombre de lignes affiché
- [ ] Status "completed"

### Terminal - Vérification Compteur
```bash
curl -b cookies.txt http://localhost:10000/api/dashboard
```

**Vérifications:**
- [ ] `totalLogs` > 0
- [ ] `totalLogs` correspond au nombre de lignes importées

### Terminal - Vérification DB
```bash
# MySQL
mysql -u root -p logsystem -e "SELECT COUNT(*) FROM logs;"
```

**Vérifications:**
- [ ] Compte correspond à l'import
- [ ] Pas de doublons excessifs

---

## 5. Recherche et Dashboard

### Navigateur - Recherche Basique
1. Ouvrir `/dashboard.html`
2. Dans la barre de recherche, entrer un mot-clé
3. Cliquer "Rechercher"

**Vérifications:**
- [ ] Résultats affichés
- [ ] Nombre de résultats cohérent
- [ ] Temps de réponse acceptable (< 2s)

### Navigateur - Filtre par Niveau
1. Sélectionner "ERROR" dans le filtre niveau
2. Rechercher

**Vérifications:**
- [ ] Seuls les logs ERROR affichés
- [ ] Compteur mis à jour

### Navigateur - Filtre par Date
1. Sélectionner une plage de dates
2. Rechercher

**Vérifications:**
- [ ] Logs dans la plage uniquement
- [ ] Compteur mis à jour

### Navigateur - Dashboard Stats
1. Ouvrir `/dashboard.html`
2. Vérifier les widgets

**Vérifications:**
- [ ] Total logs affiché
- [ ] Distribution par niveau visible
- [ ] Tendances affichées
- [ ] Top errors présents

### Terminal - API Recherche
```bash
curl -b cookies.txt "http://localhost:10000/api/search?q=error&limit=10"
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Résultats JSON valides
- [ ] Champs: id, timestamp, level, message, etc.

### Terminal - API Dashboard
```bash
curl -b cookies.txt http://localhost:10000/api/dashboard
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Stats complètes

### Terminal - API Top Errors
```bash
curl -b cookies.txt http://localhost:10000/api/dashboard/top-errors
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Liste des erreurs fréquentes

---

## 6. Alertes

### Navigateur - Création Règle d'Alerte
1. Ouvrir `/admin.html` → Alertes
2. Cliquer "Créer une règle"
3. Configurer:
   - Nom: "Test Error Alert"
   - Condition: level = ERROR
   - Fenêtre: 5 minutes
   - Seuil: 10 occurrences
4. Activer la règle

**Vérifications:**
- [ ] Règle créée
- [ ] Visible dans la liste
- [ ] Status "active"

### Navigateur - Test Déclenchement
1. Importer un fichier avec des erreurs
2. Attendre quelques minutes

**Vérifications:**
- [ ] Alertes générées si seuil atteint
- [ ] Alertes visibles dans la liste

### Navigateur - Marquer comme Lu
1. Sélectionner une alerte
2. Cliquer "Marquer comme lu"

**Vérifications:**
- [ ] Status passe à "read"
- [ ] Notification de succès

### Terminal - API Alertes
```bash
curl -b cookies.txt http://localhost:10000/api/admin/alerts
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Liste d'alertes retournée

### Terminal - API Règles
```bash
curl -b cookies.txt http://localhost:10000/api/admin/alert-rules
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Liste de règles retournée

---

## 7. Rétention

### Navigateur - Stats Rétention
1. Ouvrir `/admin.html` → Rétention
2. Vérifier les stats

**Vérifications:**
- [ ] Total logs affiché
- [ ] Configuration visible
- [ ] Date de dernière exécution

### Terminal - API Stats Rétention
```bash
curl -b cookies.txt http://localhost:10000/api/admin/retention/stats
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Stats complètes

### Navigateur - Run Rétention (avec précaution!)
⚠️ **ATTENTION**: Cette opération supprime des logs!

1. Ouvrir `/admin.html` → Rétention
2. Configurer une période courte (ex: 1 jour)
3. Cliquer "Exécuter"
4. Confirmer

**Vérifications:**
- [ ] Exécution sans erreur
- [ ] Logs supprimés affichés
- [ ] Stats mises à jour
- [ ] Audit log enregistré

### Terminal - API Run Rétention (avec précaution!)
⚠️ **ATTENTION**: Cette opération supprime des logs!

```bash
curl -b cookies.txt -X POST http://localhost:10000/api/admin/retention/run \
  -H "Content-Type: application/json" \
  -d '{"days":1}'
```

**Vérifications:**
- [ ] HTTP 200
- [ ] Nombre de logs supprimés retourné
- [ ] Pas d'erreur SQL

---

## 8. Purge Manuelle

### Terminal - Purge Sans Critère (doit échouer)
```bash
curl -b cookies.txt -X POST http://localhost:10000/api/admin/purge \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Vérifications:**
- [ ] HTTP 400
- [ ] Message d'erreur explicite

### Terminal - Purge Niveau Invalide (doit échouer)
```bash
curl -b cookies.txt -X POST http://localhost:10000/api/admin/purge \
  -H "Content-Type: application/json" \
  -d '{"level":"INVALID_LEVEL"}'
```

**Vérifications:**
- [ ] HTTP 400
- [ ] Message d'erreur explicite

### Navigateur - Purge par Niveau (avec précaution!)
⚠️ **ATTENTION**: Cette opération supprime des logs!

1. Ouvrir `/admin.html` → Purge
2. Sélectionner niveau: DEBUG
3. Cliquer "Purger"
4. Confirmer

**Vérifications:**
- [ ] Confirmation demandée
- [ ] Suppression exécutée
- [ ] Nombre de logs supprimés affiché
- [ ] Audit log enregistré

### Navigateur - Purge par Date (avec précaution!)
⚠️ **ATTENTION**: Cette opération supprime des logs!

1. Ouvrir `/admin.html` → Purge
2. Sélectionner une date passée
3. Cliquer "Purger"
4. Confirmer

**Vérifications:**
- [ ] Confirmation demandée
- [ ] Suppression exécutée
- [ ] Nombre de logs supprimés affiché
- [ ] Audit log enregistré

### Navigateur - Purge Combinée (avec précaution!)
⚠️ **ATTENTION**: Cette opération supprime des logs!

1. Ouvrir `/admin.html` → Purge
2. Sélectionner niveau: INFO
3. Sélectionner une date passée
4. Cliquer "Purger"
5. Confirmer

**Vérifications:**
- [ ] Confirmation demandée
- [ ] Suppression exécutée
- [ ] Nombre de logs supprimés affiché
- [ ] Audit log enregistré

---

## 9. Robustesse DB / Schéma

### Terminal - Vérification Tables
```bash
mysql -u root -p logsystem -e "SHOW TABLES;"
```

**Vérifications:**
- [ ] `logs` présente
- [ ] `users` présente
- [ ] `alerts` présente
- [ ] `error_groups` présente
- [ ] `audit_log` présente
- [ ] `import_jobs` présente
- [ ] `alert_rules` présente

### Terminal - Vérification Colonnes Logs
```bash
mysql -u root -p logsystem -e "DESCRIBE logs;"
```

**Vérifications:**
- [ ] `id` présent
- [ ] `timestamp` présent
- [ ] `imported_at` présent
- [ ] `log_level` présent
- [ ] `fingerprint` présent
- [ ] `source` présent
- [ ] `service` présent
- [ ] `message` présent

### Terminal - Vérification Index
```bash
mysql -u root -p logsystem -e "SHOW INDEX FROM logs;"
```

**Vérifications:**
- [ ] Index sur `timestamp`
- [ ] Index sur `log_level`
- [ ] Index sur `fingerprint`
- [ ] Index sur `imported_at`

### Terminal - Diagnostic Complet
```bash
npm run diagnose:comprehensive
```

**Vérifications:**
- [ ] Schéma valide
- [ ] Intégrité OK
- [ ] Audit log OK
- [ ] Timestamps OK
- [ ] Recherche OK
- [ ] Watcher OK

---

## 10. Sécurité

### Terminal - Rate Limit
```bash
# Exécuter rapidement 20 requêtes
for i in {1..20}; do
  curl -s http://localhost:10000/health > /dev/null
done
```

**Vérifications:**
- [ ] Requêtes bloquées après le seuil
- [ ] HTTP 429 retourné

### Navigateur - Session Cookie
1. Login
2. Ouvrir les DevTools → Application → Cookies
3. Vérifier le cookie `connect.sid`

**Vérifications:**
- [ ] Cookie présent
- [ ] HttpOnly en production
- [ ] Secure en production (HTTPS)

### Navigateur - CSRF Protection
1. Login
2. Ouvrir DevTools → Network
3. Effectuer une action POST
4. Vérifier les headers

**Vérifications:**
- [ ] Header `x-csrf-token` présent
- [ ] Token valide

---

## 11. Performance Légère

### Import de 1000 Logs
1. Préparer un fichier avec 1000 lignes
2. Importer via UI
3. Chronométrer

**Vérifications:**
- [ ] Import < 30 secondes
- [ ] Pas de timeout
- [ ] Dashboard charge après import

### Recherche
1. Rechercher un mot-clé commun
2. Chronométrer

**Vérifications:**
- [ ] Résultats < 2 secondes
- [ ] Pas de timeout

### Dashboard
1. Ouvrir `/dashboard.html`
2. Chronométrer le chargement

**Vérifications:**
- [ ] Chargement < 3 secondes
- [ ] Tous les widgets affichés

---

## Résumé Final

Avant de valider la plateforme comme OK, vérifier:

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

---

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
