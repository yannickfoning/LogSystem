# Audit de Sécurité - Vulnérabilités NPM

Date : 2026-10-23
Total : 19 vulnérabilités (3 critiques, 10 hautes, 6 modérées)

## Vulnérabilités Critiques (3)

### 1. decompress (CRITICAL)
- **Problème** : Extraction d'archive peut créer des fichiers et liens hors du répertoire cible (Zip Slip)
- **Impact** : Path traversal, écriture arbitraire de fichiers
- **Statut** : Aucun correctif disponible
- **Action requise** : Remplacer par une alternative plus sûre (archiver, unzipper)

### 2. proxy-addr (CRITICAL)
- **Problème** : IP spoofing via IPv4-mapped IPv6 trust subnet
- **Impact** : Contournement de la validation d'IP
- **Statut** : Correctif disponible via `npm audit fix`
- **Action requise** : Mettre à jour express et dépendances

### 3. tar (CRITICAL)
- **Problème** : Multiple DoS via crafted tar entries (process crash, infinite loop, uncontrolled recursion)
- **Impact** : Déni de service
- **Statut** : Correctif disponible via `npm audit fix`
- **Action requise** : Mettre à jour tar

## Vulnérabilités Hautes (10)

- body-parser (DoS via invalid limit value, trailing bytes)
- brace-expansion (DoS via exponential-time expansion)
- compression (memory leak)
- multer (multiple DoS)
- mysql2 (credential leak, decompression-bomb DoS)
- nanoid (infinite loop)
- postcss (path traversal)
- source-map-js (event-loop DoS)
- vite (cross-origin script execution, arbitrary command execution)
- zod (memory exhaustion)

## Vulnérabilités Modérées (6)

- @vitest/mocker (path traversal, code injection)
- fast-copy (stack exhaustion)
- qs (array-limit bypass, DoS)

## Plan d'Action Immédiat

### Priorité 1 (Critique - Doit être fait)

1. **Remplacer decompress**
   - Remplacer par `archiver` ou `unzipper` qui sont plus sûrs
   - Mettre à jour le code d'extraction d'archives

2. **Mettre à jour tar**
   ```bash
   npm install tar@latest
   npm shrinkwrap
   ```

3. **Mettre à jour express et proxy-addr**
   ```bash
   npm install express@latest
   npm shrinkwrap
   ```

### Priorité 2 (Haute - Recommandé)

4. **Mettre à jour mysql2**
   ```bash
   npm install mysql2@latest
   npm shrinkwrap
   ```

5. **Mettre à jour multer**
   ```bash
   npm install multer@latest
   npm shrinkwrap
   ```

6. **Mettre à jour zod**
   ```bash
   npm install zod@latest
   npm shrinkwrap
   ```

### Priorité 3 (Modérée - Peut attendre)

7. Mettre à jour les autres dépendances une fois les critiques résolues

## Notes

- Le projet utilise `npm-shrinkwrap.json` au lieu de `package-lock.json`
- Après chaque mise à jour de dépendance, exécuter `npm shrinkwrap` pour mettre à jour le fichier de verrouillage
- Tester complètement après chaque mise à jour majeure (express, mysql2, zod) car elles peuvent introduire des breaking changes
- La vulnérabilité `decompress` est la plus critique car elle n'a pas de correctif disponible et nécessite un remplacement complet

## Recommandation pour la Production

Pour un déploiement en production immédiat :
1. Corriger les 3 vulnérabilités critiques (decompress, proxy-addr, tar)
2. Documenter les vulnérabilités restantes comme "risque accepté" temporaire
3. Planifier les corrections des vulnérabilités hautes dans les prochaines semaines
