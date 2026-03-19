# Contributing to BirdBoard

Merci de vouloir contribuer ! 🐦
Voici comment participer au projet.

## Quick Start

### Prérequis

- [BirdNET-Pi](https://github.com/mcguirepr89/BirdNET-Pi) installé et fonctionnel
- Node.js 18+ avec `better-sqlite3`
- Caddy (ou autre reverse proxy)

### Installation locale

```bash
git clone https://github.com/ernens/BirdBoard.git
cd BirdBoard
npm install
cp birdash-local.example.js birdash-local.js
# Éditer birdash-local.js avec vos paramètres
npm start
```

L'API est disponible sur `http://localhost:7474`.
Les pages HTML s'ouvrent directement dans le navigateur ou via votre reverse proxy.

### Tests

```bash
npm test
```

Les 19 tests backend vérifient la sécurité, les routes API et la validation SQL.

## Comment contribuer

### 1. Signaler un bug

Ouvrez une [Issue](https://github.com/ernens/BirdBoard/issues) avec :
- Description claire du problème
- Étapes pour reproduire
- Comportement attendu vs observé
- Screenshots si possible
- Environnement (navigateur, OS, version Node)

### 2. Proposer une amélioration

Ouvrez une Issue avec le label `enhancement` pour discuter de l'idée avant de coder.

### 3. Soumettre du code

1. **Fork** le repo
2. Créez une branche : `git checkout -b feature/ma-fonctionnalite`
3. Codez vos modifications
4. Vérifiez que les tests passent : `npm test`
5. Commitez : `git commit -m "Add: description de la feature"`
6. Poussez : `git push origin feature/ma-fonctionnalite`
7. Ouvrez une **Pull Request** vers `main`

## Architecture du projet

```
BirdBoard/
├── bird-server.js        # Backend Node.js (API HTTP + SQLite)
├── bird-vue-core.js      # Composables Vue 3 partagés (i18n, thèmes, charts)
├── bird-config.js        # Configuration centrale
├── bird-styles.css       # Styles globaux + 5 thèmes
├── bird-pages.css        # Styles spécifiques aux pages
├── sw.js                 # Service Worker (cache offline)
├── birdash-local.js       # Config locale (non versionné)
├── index.html            # Vue d'ensemble (dashboard)
├── species.html          # Fiche espèce détaillée
├── recordings.html       # Meilleurs enregistrements
├── detections.html       # Journal des détections
├── biodiversity.html     # Matrice biodiversité
├── rarities.html         # Espèces rares
├── stats.html            # Statistiques
├── analyses.html         # Analyses avancées
├── spectrogram.html      # Spectrogramme
├── today.html            # Détections du jour
├── recent.html           # Détections récentes
├── system.html           # État du système
└── bird-server.test.js   # Tests backend (node:test)
```

### Stack technique

- **Frontend** : Vue 3 via CDN (pas de build), Chart.js, Composition API
- **Backend** : Node.js HTTP natif, better-sqlite3 (lecture seule)
- **Proxy** : Caddy avec compression zstd/gzip
- **Sécurité** : Rate limiting, validation SQL, SRI, CORS, CSP headers
- **i18n** : FR / EN / NL

## Conventions de code

- **Pas de build system** — les fichiers sont servis tels quels
- **Vue 3 CDN** — pas d'imports ES modules, tout via `window.BIRDASH`
- **Indentation** : 2 espaces
- **Nommage** : `camelCase` pour JS, `kebab-case` pour CSS
- **Commits** : messages courts et descriptifs en anglais
  - `Add:` nouvelle fonctionnalité
  - `Fix:` correction de bug
  - `Update:` amélioration existante
  - `Refactor:` restructuration sans changement fonctionnel

## Idées de contributions

Voici quelques pistes pour les nouveaux contributeurs :

- 🌍 **Traductions** : ajouter une langue (DE, ES, IT…) dans `bird-vue-core.js`
- 📊 **Nouveaux graphiques** : tendances saisonnières, comparaisons inter-annuelles
- 🗺️ **Carte** : afficher les observations eBird proches sur une carte
- 📱 **Responsive** : améliorer l'affichage mobile
- 🎨 **Thèmes** : proposer de nouveaux thèmes de couleurs
- 🔔 **Notifications** : alertes push pour les espèces rares
- 📈 **Export** : export CSV/PDF des données et rapports

## Licence

Ce projet est sous licence [MIT](LICENSE). En contribuant, vous acceptez que vos contributions soient sous la même licence.

---

Des questions ? Ouvrez une Issue ou contactez-nous. Bonne observation ! 🦉
