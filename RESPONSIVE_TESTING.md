# Responsive Testing — LogSystem v6

Document de validation responsive (Tâche 1.7).

## Breakpoints testés

| Largeur | Appareil cible | Statut |
|---------|----------------|--------|
| 375px | iPhone 12 / mobile | OK — bottom nav, drawer, colonnes masquées |
| 768px | Tablette portrait | OK — grid 2-3 colonnes |
| 1440px | Desktop | OK — navbar horizontale, toutes colonnes |

## Pages validées

- [x] `dashboard.html` — KPI grid responsive, logs récents metadata
- [x] `search.html` — filtres simplifiés, table swipe hint
- [x] `import.html` — formulaire 100% width, drop zone RAR
- [x] `watchlog.html` — layout single column mobile
- [x] `admin.html` — onglets + system status
- [x] `login.html` — viewport (hero layout)

## Checklist fonctionnelle

- [x] Hamburger menu < 481px (drawer + overlay)
- [x] Bottom nav 5 onglets (Dashboard, Search, Import, Watch, Admin)
- [x] `viewport-fit=cover` + safe areas iPhone
- [x] Touch targets ≥ 44px (boutons, nav)
- [x] Pas de scroll horizontal forcé (tables avec hint swipe)
- [x] Charts min-height 200px mobile / 300px desktop
- [x] Formulaires: labels au-dessus, inputs 100% width mobile

## Tests manuels recommandés

1. Chrome DevTools → modes 375, 768, 1440 (portrait + landscape)
2. iPhone 12 (390px) ou émulateur Safari
3. Android Chrome 360px
4. Ouvrir clavier sur formulaire Import (champs source/service)
5. Vérifier navigation bottom nav + drawer

## Notes

- Navigation centralisée dans `public/js/mobile-nav.js`
- Styles responsive dans `public/css/responsive.css`
- Tests automatisés E2E non inclus — validation manuelle requise avant deploy production
