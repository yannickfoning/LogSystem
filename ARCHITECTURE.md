# Architecture LogSystem

## Vue d'ensemble

LogSystem utilise une architecture hybride Next.js + Express pour combiner les avantages des deux frameworks.

## Frontend (Next.js)

### Structure
```
src/
├── app/                    # Application Next.js
│   ├── api/               # API Routes Next.js
│   ├── dashboard/         # Pages Dashboard
│   ├── login/             # Pages Login
│   ├── admin/             # Pages Admin
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/            # Composants React
│   ├── ui/               # Composants UI de base (Radix UI)
│   ├── dashboard/        # Composants spécifiques Dashboard
│   └── ...
├── lib/                  # Bibliothèques TypeScript
│   ├── api-client.ts     # Client API
│   ├── auth.ts           # Authentification
│   ├── db.ts             # Client Prisma
│   └── ...
├── hooks/                # Hooks React
└── stores/               # Stores Zustand
```

### Responsabilités
- **Rendu UI**: Pages React avec Server Components
- **API Routes Additionnelles**: Endpoints spécifiques Next.js
- **Client API**: Communication avec le backend Express
- **State Management**: Stores Zustand pour l'état frontend

## Backend (Express)

### Structure
```
server.js                # Point d'entrée Express
├── routes/              # Routes API Express
│   ├── auth.js         # Authentification
│   ├── logs.js         # Logs CRUD
│   ├── import.js       # Import de logs
│   ├── dashboard.js    # Dashboard API
│   ├── admin.js        # Administration
│   └── api/
│       └── search.js   # Recherche
├── services/           # Services métier
│   ├── alertEngine.js  # Moteur d'alertes
│   ├── watcherService.js # Watcher de fichiers
│   ├── retentionService.js # Rétention
│   ├── cacheService.js # Cache Redis
│   ├── errorAnalyzer.js # Analyse d'erreurs
│   └── anomaliesService.js # Détection d'anomalies
├── middleware/         # Middleware Express
│   ├── auth.js         # Authentification
│   ├── csrf.js         # Protection CSRF
│   ├── scopeGuard.js   # Guard de scope
│   ├── htmlCsp.js      # CSP pour HTML
│   ├── validation.js   # Validation
│   └── audit.js        # Audit
├── lib/                # Bibliothèques JavaScript
│   ├── database/       # Migration runner
│   ├── processing/     # Traitement de logs
│   └── levels.js       # Noms de niveaux
└── workers/            # Workers background
    └── alertWorker.js  # Worker alertes SSE
```

### Responsabilités
- **API Principale**: Routes Express pour CRUD et métier
- **Services Business Logic**: Alertes, watcher, rétention, cache
- **Middleware**: Auth, CSRF, validation, audit
- **Processing**: Parsing de logs (multiple formats)
- **Workers**: Tâches background (SSE alerts)

## Base de données

### Structure
```
prisma/
└── schema.prisma        # Schema Prisma

db/
├── schema.sql           # Schema de base
├── migrations/          # Migrations SQL
├── indexes.sql          # Indexes
└── ...

migrations/
└── add_indexes.sql      # Migrations additionnelles
```

### Technologies
- **ORM**: Prisma (TypeScript)
- **Base**: MySQL/MariaDB
- **Migrations**: SQL natif + Prisma

## Assets Statiques

### Structure
```
public/
├── *.html               # Pages HTML statiques (login, dashboard, etc.)
├── *.css                # Styles CSS
├── *.js                 # Scripts JavaScript (api.js, i18n.js, etc.)
├── logo.svg             # Logo
├── robots.txt           # Robots.txt
└── image/               # Images (vide actuellement)
```

### Utilisation
- Pages HTML servies par Express
- CSS/JS chargés par les pages HTML
- Assets pour l'interface Express

## Scripts Utilitaires

### Structure
```
scripts/
├── apply-schema.js      # Application du schema
├── check-create-users.js # Vérification création users
├── check-users.js       # Vérification users
├── create-default-users.js # Création users par défaut
├── list-tables.js       # Liste des tables
├── project-root.js      # Racine du projet
├── seed.js              # Seeding de données
├── test-format-detection.js # Test détection format
├── run/                 # Scripts de démarrage
│   ├── restart.sh
│   └── start-server.bat
└── tools/               # Outils
    ├── create-alert-rules.js
    ├── generate-secret.js
    └── reset-user-password.js
```

## Configuration

### Structure
```
config/
├── database.js          # Configuration base de données
└── logger.js            # Configuration logger

.env                     # Variables d'environnement
.env.example             # Exemple de configuration
next.config.ts           # Configuration Next.js
tsconfig.json            # Configuration TypeScript
tailwind.config.ts       # Configuration Tailwind
docker-compose.yml       # Configuration Docker
Dockerfile              # Image Docker
Caddyfile               # Configuration Caddy
```

## Flux de données

### Authentification
1. User se connecte via `/api/auth/login` (Express)
2. Session stockée en base (MySQL)
3. Middleware Express vérifie la session
4. Frontend Next.js utilise le client API pour communiquer

### Logs
1. Fichiers de logs surveillés par `watcherService`
2. Logs parsés par `lib/processing/`
3. Logs stockés en base via Prisma
4. Alertes déclenchées par `alertEngine`
5. Frontend affiche les logs via API Express

### Alertes
1. `alertEngine` évalue les règles en continu
2. Alertes envoyées via `alertWorker` (SSE)
3. Frontend reçoit les alertes en temps réel

## Conventions de nommage

### Fichiers
- **TypeScript**: `.ts`, `.tsx` (camelCase)
- **JavaScript**: `.js` (camelCase)
- **CSS**: `.css` (kebab-case pour classes)
- **SQL**: `.sql` (snake_case)

### Dossiers
- **kebab-case**: `api-client`, `alert-engine`, etc.
- **Pluriel pour collections**: `components`, `routes`, `services`

### Variables
- **camelCase**: `userId`, `alertEngine`, etc.
- **PascalCase**: Classes, composants React

## Dépendances clés

### Frontend
- Next.js 16
- React 19
- Radix UI (composants)
- Zustand (state management)
- Recharts (graphiques)
- Tailwind CSS (styling)

### Backend
- Express
- Prisma (ORM)
- MySQL/MariaDB
- Redis (cache optionnel)
- Chokidar (file watching)

### Processing
- 7zip-min, unzipper, decompress (archives)
- pdfkit (PDF export)

## Points d'attention

### Architecture hybride
- Express et Next.js coexistent
- Express gère l'authentification et les routes principales
- Next.js gère le frontend et certaines API routes
- Éviter la duplication des endpoints

### Performance
- Cache Redis optionnel pour améliorer les performances
- Worker SSE pour les alertes en temps réel
- File watching pour l'import automatique

### Sécurité
- CSRF protection sur toutes les routes
- CSP headers configurés
- Session stockée en base de données
- Rate limiting sur les endpoints sensibles

## Roadmap d'amélioration

### Court terme
- Uniformiser les conventions de nommage
- Réorganiser `public/` pour mieux structurer les assets
- Documenter chaque service et route

### Moyen terme
- Considérer migration vers Next.js API routes uniquement
- Simplifier l'architecture hybride
- Améliorer la séparation frontend/backend

### Long terme
- Architecture monorepo avec packages séparés
- Microservices pour les services métier
- Event-driven architecture pour les alertes
