# Checklist de Validation Production

Checklist complète pour valider la plateforme LogSystem avant et après déploiement en production.

## Préconditions

Avant de commencer la validation, vérifier :

- [ ] **Serveur en cours d'exécution**
  ```bash
  npm start
  ```
  - Le serveur démarre sans erreur
  - Le port 10000 est accessible (ou port configuré)

- [ ] **Base de données connectée**
  ```bash
  npm run diagnose:counts
  ```
  - Connexion MySQL établie
  - Tables accessibles

- [ ] **Admin utilisateur existe**
  ```bash
  npm run diagnose:admin
  ```
  - Admin présent dans la base
  - Credentials valides

- [ ] **Variables d'environnement configurées**
  - `.env` ou `.env.production` configuré
  - Secrets (JWT_SECRET, etc.) définis
  - Credentials base de données valides

- [ ] **Redis connecté (si utilisé)**
  - Connexion Redis fonctionnelle
  - Session store opérationnel

---

## 1. Smoke Test (Validation Rapide Non-Destructive)

Exécuter le smoke test pour vérifier les endpoints critiques :

```bash
npm run smoke-test
```

### Critères de succès

- [ ] Health endpoint répond (HTTP 200)
- [ ] Login admin réussit (HTTP 200/204)
- [ ] Admin status accessible (HTTP 200)
- [ ] Users list accessible (HTTP 200)
- [ ] Retention stats accessibles (HTTP 200)
- [ ] Search API fonctionnelle (HTTP 200)

### Cas d'échec

**Si health échoue** :
- Vérifier que le serveur est démarré
- Vérifier le port et la configuration réseau

**Si login échoue (401/403)** :
- Recréer l'admin : `npm run create-admin`
- Vérifier les credentials dans l'environnement

**Si endpoints admin échouent** :
- Vérifier les permissions de l'utilisateur
- Vérifier la configuration du middleware d'authentification

---

## 2. Diagnostics Complets

Exécuter les diagnostics pour valider l'état complet du système :

```bash
npm run diagnose:comprehensive
```

### Critères de succès

- [ ] Tables existent (logs, users, alerts, sessions, etc.)
- [ ] Indexes présents
- [ ] Aucune erreur de structure
- [ ] Aucune incohérence de données
- [ ] Règles d'alerte valides
- [ ] Time windows configurées

### Diagnostics individuels (optionnels si échec)

```bash
npm run diagnose:alerts    # Règles d'alerte
npm run diagnose:rules     # Time windows
npm run diagnose:counts    # Compteurs
```

---

## 3. Validation Manuelle des Fonctionnalités

### 3.1 Authentification

- [ ] **Login admin** via UI
  - Accéder à `/login`
  - Se connecter avec l'admin
  - Redirection vers le dashboard réussie

- [ ] **Session persistante**
  - Recharger la page
  - Toujours connecté
  - Cookie de session valide

- [ ] **Logout**
  - Déconnexion fonctionnelle
  - Redirection vers login
  - Session invalidée

### 3.2 Dashboard

- [ ] **Dashboard principal**
  - Page charge sans erreur
  - Graphiques affichés
  - Données cohérentes

- [ ] **Top errors**
  - Liste des erreurs affichée
  - Détails accessibles
  - Filtres fonctionnels

- [ ] **Alertes**
  - Liste des alertes affichée
  - États corrects (active/inactive)
  - Actions possibles

### 3.3 Recherche

- [ ] **Recherche simple**
  - Rechercher "ERROR"
  - Résultats affichés
  - Pagination fonctionnelle

- [ ] **Recherche avancée**
  - Filtres par niveau
  - Filtres par date
  - Filtres par application

### 3.4 Admin

- [ ] **Gestion utilisateurs**
  - Liste des utilisateurs accessible
  - Création d'utilisateur possible
  - Modification possible
  - Suppression possible (avec confirmation)

- [ ] **Système status**
  - Infos système affichées
  - Compteurs cohérents
  - État de la base de données

---

## 4. Purge / Rétention avec Garde-Fous

⚠️ **ATTENTION** : Cette section est destructive. Ne procéder que si nécessaire et avec backup.

### 4.1 Pré-purge (Garde-fous)

Avant toute opération de purge :

- [ ] **Backup de la base de données**
  ```bash
  mysqldump -u root -p logsystem > backup-pre-purge-$(date +%Y%m%d-%H%M%S).sql
  ```

- [ ] **Vérifier le volume de données**
  ```bash
  npm run diagnose:counts
  ```
  - Noter le nombre de logs avant purge
  - Noter le nombre d'utilisateurs
  - Noter le nombre d'alertes

- [ ] **Vérifier les règles de rétention**
  - Périodes configurées
  - Logs à conserver identifiés
  - Logs à purger identifiés

### 4.2 Purge Manuelle (Si Nécessaire)

Via l'interface admin :
- [ ] Accéder à la section rétention
- [ ] Configurer les périodes (si non configurées)
- [ ] Sélectionner les logs à purger
- [ ] Confirmer avec la case à cocher "Je comprends les risques"
- [ ] Exécuter la purge
- [ ] Vérifier le résultat

Via script (non recommandé en prod) :
```bash
# SEULEMENT si nécessaire et avec backup
npm run maintenance:cleanup
```

### 4.3 Post-purge Validation

- [ ] **Vérifier les compteurs**
  ```bash
  npm run diagnose:counts
  ```
  - Comparer avec les chiffres pré-purge
  - Vérifier que les logs récents sont conservés

- [ ] **Vérifier les fonctionnalités**
  - Smoke test toujours OK
  - Dashboard affiche des données
  - Recherche fonctionne

- [ ] **Vérifier les alertes**
  - Alertes toujours actives
  - Nouvelles alertes générées si applicable

---

## 5. Validation Finale

### 5.1 Stabilité

- [ ] **Charge du serveur**
  - CPU stable
  - Mémoire stable
  - Pas de memory leak

- [ ] **Latence**
  - Réponses < 1s pour les endpoints critiques
  - Dashboard charge en < 2s
  - Recherche répond en < 1s

### 5.2 Monitoring

- [ ] **Logs applicatifs**
  - Pas d'erreurs critiques
  - Pas d'exceptions non gérées
  - Logs de niveau INFO/DEBUG normaux

- [ ] **Alertes système**
  - Aucune alerte critique
  - Aucune alerte d'espace disque
  - Aucune alerte de CPU/mémoire

### 5.3 Signaux de Risque à Surveiller

🔴 **Critique** :
- Smoke test échoue
- Login admin impossible
- Base de données inaccessible
- Memory leak détecté

🟡 **Attention** :
- Latence > 2s sur les endpoints critiques
- Dashboard charge lentement
- Erreurs intermittentes dans les logs

🟢 **Normal** :
- Smoke test OK
- Diagnostics OK
- Fonctionnalités UI OK
- Latence acceptable

---

## Ordre Logique de Validation

1. **Préconditions** - Vérifier que l'environnement est prêt
2. **Smoke test** - Validation rapide des endpoints critiques
3. **Diagnostics** - Validation complète de l'état système
4. **Validation manuelle** - Tests fonctionnels via UI
5. **Purge/rétention** - SEULEMENT si nécessaire, avec garde-fous
6. **Validation finale** - Vérification de la stabilité et monitoring

---

## Résumé des Commandes

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

# Maintenance (avec précautions)
npm run maintenance:cleanup
npm run maintenance:sessions

# Tests automatisés
npm test
npm run test:platform
```

---

## Notes

- Cette checklist est conçue pour les déploiements en production
- Les opérations destructives (purge) doivent être évitées autant que possible
- Les backups sont obligatoires avant toute purge
- Le smoke test doit être exécuté avant et après toute opération
- En cas d'échec, arrêter et investiguer avant de continuer
