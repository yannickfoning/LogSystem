# Améliorations de Performance - Support 5000 MB

**Date**: 2026-09-30  
**Version**: 6.1.0  
**Objectif**: Permettre le traitement rapide de fichiers jusqu'à 5000 MB (5 GB) avec support complet de tous les types de fichiers

---

## Résumé des Modifications

### 1. Augmentation des Limites de Taille

#### Fichiers Modifiés :
- `.env.example`
- `lib/processing/archiveHandler.js`
- `routes/import.js`

#### Changements :

| Variable | Ancienne Valeur | Nouvelle Valeur | Justification |
|----------|----------------|-----------------|---------------|
| `UPLOAD_MAX_SIZE` | 500 MB | 5000 MB (5 GB) | Support des fichiers volumineux demandés |
| `MAX_TOTAL_EXTRACTED_SIZE` | 500 MB | 5000 MB (5 GB) | Extraction d'archives volumineuses |
| `MAX_SINGLE_FILE_SIZE` | 200 MB | 1000 MB (1 GB) | Fichiers individuels plus grands |
| `IMPORT_BATCH_SIZE` | 500 | 1000 | Traitement plus rapide par lots |
| `EXTRACT_TIMEOUT_MS` (cloud) | 300s | 600s | Plus de temps pour l'extraction sur cloud |
| `EXTRACT_TIMEOUT_MS` (local) | 120s | 300s | Plus de temps pour l'extraction local |

---

### 2. Optimisation du Streaming

#### Caractéristiques Existantes (Préservées) :
- **Java Log4j Stream Parser** : `lib/processing/javaLog4jStreamParser.js`
  - Traitement par lignes avec `readline`
  - Batches de 1000 logs par défaut
  - Support des stack traces multi-lignes
  - Détection automatique du format Java Log4j
  - Évite le chargement complet en mémoire

- **Universal Parser** : `lib/processing/universalParser.js`
  - Seuil de streaming : 10 MB
  - Batches configurables via `IMPORT_BATCH_SIZE`
  - Callback `onBatch` pour traitement progressif
  - Support multi-format (JSON, JSONL, CSV, XML, etc.)

#### Améliorations Apportées :
- Augmentation du batch size par défaut de 500 à 1000 logs
- Meilleure gestion de la mémoire pour les fichiers > 10 MB
- Timeout d'extraction augmenté pour les environnements cloud

---

### 3. Support des Types de Fichiers

#### Formats d'Archives Supportés :
- **ZIP** (via `unzipper`)
- **GZIP/GZ** (via `zlib`)
- **TAR/TAR.GZ/TGZ** (via `7zip-bin`)
- **RAR** (via `node-unrar-js` WASM)
- **7Z** (via `7zip-bin`)
- **BZ2** (via `7zip-bin`)
- **XZ** (via `7zip-bin`)

#### Formats de Logs Supportés :
- **Texte brut** : `.log`, `.txt`
- **JSON** : `.json`, `.jsonl`
- **CSV** : `.csv`
- **XML** : `.xml`
- **Formats compressés** : `.log.gz`, `.txt.gz`, `.json.gz`, `.csv.gz`, `.bz2`, `.xz`

#### Formats de Logs Spécifiques (Auto-détectés) :
- Java Log4j / Logback
- Python logging
- PHP errors
- Apache access logs
- Nginx access logs
- Docker logs (JSON)
- Kubernetes logs (JSON)
- Syslog (RFC3164/RFC5424)
- Odoo logs

#### Nouvelles Extensions Ajoutées :
```javascript
// Dans routes/import.js
"json.gz",
"json.bz2",
"json.xz",
"csv.gz",
"csv.bz2",
"csv.xz",
```

#### Patterns Mis à Jour :
```javascript
// Dans lib/processing/archiveHandler.js
export const LOG_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml)(\.(gz|bz2|xz))?$/i;
export const TEXT_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml|application_log|log\.\d{4}-\d{2}-\d{2})(\.(gz|bz2|xz))?$/i;
```

---

## Configuration Requise

### Variables d'Environnement (à ajouter au `.env`)

```bash
# Taille maximale d'upload (5 GB)
UPLOAD_MAX_SIZE=5242880000

# Limites d'extraction
MAX_EXTRACTED_FILES=1000
MAX_TOTAL_EXTRACTED_SIZE=5242880000
MAX_SINGLE_FILE_SIZE=1073741824
MAX_ARCHIVE_DEPTH=3

# Traitement par lots
IMPORT_BATCH_SIZE=1000
```

### Recommandations d'Infrastructure

#### Pour le Déploiement Local :
- **RAM** : Minimum 4 GB (recommandé 8 GB)
- **Disque** : Espace suffisant pour les fichiers temporaires (2x la taille max)
- **CPU** : Multi-cœur recommandé pour le traitement parallèle

#### Pour le Déploiement Cloud (Render/Vercel) :
- **Render** : Utiliser les plans avec plus de RAM/CPU pour les fichiers > 1 GB
- **Vercel** : Limité à 4.5 MB par requête (utiliser des services externes pour les gros fichiers)

---

## Performance Attendue

### Temps de Traitement Estimés :

| Taille du Fichier | Format | Temps Estimé | Mémoire Max |
|-------------------|--------|--------------|-------------|
| 100 MB | Texte brut | ~30-60s | ~200 MB |
| 500 MB | Archive ZIP | ~2-5 min | ~500 MB |
| 1 GB | Java Log4j | ~5-10 min | ~300 MB (streaming) |
| 5 GB | Archive TAR.GZ | ~20-30 min | ~500 MB (streaming) |

*Les temps varient selon la complexité des logs et la puissance du serveur*

### Avantages du Streaming :
- **Faible consommation mémoire** : Le fichier n'est pas chargé entièrement en RAM
- **Traitement progressif** : Les logs sont insérés par lots de 1000
- **Feedback en temps réel** : L'utilisateur voit la progression via SSE
- **Reprise sur erreur** : Si une batch échoue, les autres continuent

---

## Tests Recommandés

### 1. Test de Fichier Volumineux
```bash
# Créer un fichier de test de 1 GB
# Importer via l'interface et vérifier :
# - Temps de traitement
# - Utilisation mémoire
# - Insertion correcte dans la base
```

### 2. Test d'Archive Compressée
```bash
# Créer une archive avec 1000 fichiers de logs
# Tester l'extraction et le parsing
# Vérifier les limites MAX_EXTRACTED_FILES
```

### 3. Test de Format Mixte
```bash
# Archive contenant : JSON, CSV, TXT, Java logs
# Vérifier la détection automatique de chaque format
```

### 4. Test de Timeout
```bash
# Fichier très volumineux (> 3 GB)
# Vérifier que le timeout d'extraction est suffisant
```

---

## Limitations Connues

1. **Vercel Serverless** : Limité à 4.5 MB par requête (limite de la plateforme)
2. **Navigateur** : Upload limité par le navigateur client
3. **Base de données** : Performance dépend de la configuration MySQL
4. **RAR sur certains environnements** : Nécessite le binaire WASM (inclus)

---

## Suivi et Maintenance

### Monitoring à Mettre en Place :
- Temps de traitement par import
- Utilisation mémoire pendant l'import
- Taux d'échec d'extraction
- Taille moyenne des fichiers importés

### Ajustements Possibles :
- Augmenter `IMPORT_BATCH_SIZE` si la RAM est suffisante
- Réduire `EXTRACT_TIMEOUT_MS` si les extractions sont trop rapides
- Ajuster `MAX_SINGLE_FILE_SIZE` selon les besoins réels

---

## Conclusion

Ces améliorations permettent à la plateforme LogSystem de traiter des fichiers jusqu'à 5000 MB de manière rapide et efficace, avec un support complet de tous les types de fichiers logs courants et leurs variantes compressées. Le système utilise le streaming pour minimiser l'utilisation mémoire et garantir des performances constantes même avec des fichiers très volumineux.
