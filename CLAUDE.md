# CLAUDE.md — OrgaSport

SaaS de gestion de concours sportifs. Un club achète un « lien concours » (`/c/7KQ2`) qui gère inscriptions, tirage, terrains, scores et résultats. Lancement pétanque, **multi-sport dès le départ**.

> État : **les 8 phases du plan sont terminées** (socle, moteur + lien concours, espace clubs + paiement, catalogue + inscription en ligne, fil + notifications, assistant IA, vidéos, finitions). Le **lot 2** (demandes du propriétaire, `docs/LOT2-PLAN.md`) a ajouté cadrage, concours B/C, 2 jours, clôture et suppression des données, pétanque seule, fiche bénévole. Mise en ligne : `docs/DEPLOIEMENT.md`.
> Plan validé : `docs/PLAN.md`. Direction visuelle : **C « Direct »**, couleurs **bleu et noir** (choix du propriétaire), vitrine futuriste (scène 3D nocturne, néons bleus). Démo : `docs/DEMO.md`.

## Organisation du travail (perfectionnement)
La session principale est le **Directeur de projet**. Le propriétaire ne parle qu'à lui.
- Le Directeur **ne code pas** : il fait travailler les chefs de pôle et les agents (`.claude/agents/`), puis fait des comptes rendus courts, en français simple.
- Lire d'abord tout le projet pour comprendre ce qui existe. **Ne pas tout réécrire** : on perfectionne.
- Avant toute modification : une branche git de travail (`perfectionnement`) ; **un commit par correction**. La branche est ensuite reportée sur la branche distante du projet.
- **Jamais** de changement de technologie ou d'architecture sans l'accord du propriétaire.
- Hébergement : **offres gratuites uniquement**.
- Après chaque lot de corrections : `pnpm -r test`, `pnpm test:db`, `pnpm test:e2e` passent et le site démarre (`pnpm build` + page d'accueil qui répond).
- Phase 1 **AUDIT** : chaque auditeur inspecte sans rien modifier et rend un rapport ; chaque chef trie son pôle en critique / important / amélioration ; le Directeur présente une liste unique priorisée et **attend l'accord**.
- Phase 2 **CORRECTIONS** : par lots, en commençant par les critiques. Un agent corrige, le testeur vérifie, le chef valide, le Directeur fait le point avant le lot suivant.

Organigramme :
```
Directeur de projet (session principale)
├── chef-produit      → expert-regles-concours, designer-ux
├── chef-technique    → relecteur-code, expert-securite, testeur, expert-performance
├── chef-business     → expert-paiement, juriste-rgpd, marketing
└── chef-realisation  → developpeur-web, developpeur-serveur, integrateur-deploiement
```
Les auditeurs corrigent ce qu'ils trouvent ; le **pôle réalisation** construit ce qui reste à faire et les demandes du propriétaire
(le chef découpe en tâches, un développeur code, le testeur vérifie, le chef valide).

## Priorités (en cas de conflit, dans cet ordre)
1. Vitesse et clarté le jour du concours : un joueur trouve son prochain match en < 10 s.
2. Automatisation maximale, mais l'organisateur peut **tout** corriger (historique + annulation).
3. Effet « waouh » sur la vitrine, sans jamais ralentir les pages « terrain ».

## Profils
Invité (préférences sur l'appareil) · Joueur · Club (plusieurs membres) · Table de marque (compte ou PIN, limité à un concours) · Admin plateforme. Un compte peut être joueur **et** gérer des clubs (bascule de profil : `profiles.active_club_id`).

## Stack
- Monorepo **pnpm** (`pnpm-workspace.yaml`), Node 22.
- **Next.js 16** (App Router, Turbopack, `cacheComponents` + `partialPrefetching` activés), React 19, TypeScript strict, **Tailwind v4**.
  - ⚠️ Next 16 diffère de Next 13-15 : `middleware` s'appelle **`proxy.ts`** ; avec Cache Components, toute lecture de cookies / `searchParams` / `params` / heure courante doit être dans un `<Suspense>` ; `"use cache"` + `cacheLife` pour les données publiques. Doc locale : `apps/web/node_modules/next/dist/docs/`.
- **Supabase** (Postgres 17, Auth, Realtime, Storage) — en local via Docker (`pnpm db:start`).
- Stripe Checkout (paiement du lien concours), Web Push (VAPID, `web-push`) + emails Resend, SDK Anthropic (`claude-haiku-5-5`, assistant), Remotion + React Three Fiber (`apps/videos`), three.js (boule 3D de l'accueil, chargée en différé).
- Tests : **Vitest** (paquets + web), **Playwright** (`apps/web/e2e`), tests RLS en SQL (`supabase/tests/rls.sql`).

## Structure
```
apps/web                  Next.js
  src/app/(vitrine)       accueil public "/" (boule 3D différée, vidéo), /decouvrir (vidéos), pages légales (vides)
  src/app/(app)           app avec navigation : accueil (fil), concours (catalogue + détail), tirage, assistant,
                          profil (notifications), club (tableau de bord, concours/nouveau = formulaire 8 étapes,
                          paiement, membres, annonces, factures, statistiques), admin (tarifs, codes promo,
                          paiements, concours, assistant, actualités), clubs/[slug] (page publique)
  src/app/(auth)          connexion, inscription/[joueur|club|invite] (une question par écran)
  src/app/c/[code]        lien concours PUBLIC : route.ts = HTML serveur léger (pas de React côté client)
    score/ affiche/ qr.svg/   saisie capitaines (formulaire POST), affiche A4, QR code
    inscription/ calendrier.ics   inscription en ligne (sans JS), fichier agenda
    equipes/              « Résultats par équipes » (HTML léger) ; `?enregistrer=1` sur /c/CODE = fichier hors ligne
    table/                table de marque (page Next + client hors ligne)
  src/app/api/t/[code]/*  API table de marque : state, commands, undo, history, pin, staff
  src/app/api/cron/tick   chaque minute : tirages à l'heure, rappels, envoi des notifications, clôture 24 h
                          après la finale, purge des données (CRON_SECRET)
  src/app/api/cron/news   chaque heure : flux RSS des actualités
  src/app/api/stripe/webhook  seule porte de publication d'un concours payé (signature vérifiée)
  src/app/api/assistant   assistant (flux SSE, outils côté serveur, quotas, budget)
  src/app/api/push/subscribe  abonnements Web Push (compte ou équipe suivie sur l'appareil)
  src/terrain/            rendu des pages terrain : html.ts (échappement), render.ts, view-model.ts,
                          live-script.ts (seul JS de la page, ES5), terrain.css → styles.generated.ts
  src/lib/tournament/     load.ts (état moteur depuis la base), execute.ts (commandes, annulation,
                          diffusion), staff.ts (compte ou PIN signé), auto-draw.ts, command-schema.ts
  src/app/auth/*          callback lien magique / OAuth, déconnexion
  src/app/api/geocode     proxy géocodage (Géoplateforme IGN)
  src/components          ui/, shell/, draw/, onboarding/, profile/, tournament/, tournament-form/, catalog/,
                          tournament-detail/, feed/, notifications/, assistant/, admin/, club/, video/, vitrine/,
                          table/ (table de marque : store.ts = file hors ligne + moteur local)
  src/lib                 supabase/ (server, client, admin, public, proxy), data/, viewer.ts, prefs.ts, format.ts,
                          tournament-form/ (schéma, valeurs par défaut, conseiller), payments/ (prix, Stripe,
                          simulation locale, webhook), notifications/, assistant/, feed/, news/, email/, ics.ts, weather.ts
  src/i18n                textes FR (fr.ts + fr/*.ts par domaine) — aucun texte en dur dans les composants
  scripts/                build-terrain-css.mjs, build-icons.mjs (icônes PWA), subset-fonts.py, build-auth-emails.ts
  e2e/                    tests Playwright
packages/sports           configs de sports (zod) : petanque.ts, football.ts
packages/engine           moteur de tirage — TS pur, 80 tests (dont tests aléatoires massifs)
  commands.ts             commandes organisateur + « règlement » automatique (forfaits, tours suivants,
                          terrains, fin du concours)
  formats.ts              élimination (fixe / nouveau tirage), poules (4 en 3 parties / chacun contre
                          chacun) + phase finale, suisse, championnat, mêlée tournante, complémentaire
  pairing.ts bracket.ts venues.ts standings.ts scoring.ts tx.ts (changements + inverses) rng.ts
packages/ui               tokens.css (TOUTES les couleurs), icônes, logo
packages/db               types générés, engine-mapping.ts (moteur ↔ tables), générateur du seed
                          (les concours de démo sont joués par le moteur) et de reference.sql (production)
apps/videos               Remotion : découverte (75 s) et tutoriel (150 s), 16:9 et 9:16 → apps/web/public/videos
supabase/                 config.toml, migrations/, seed.sql (démo, généré), reference.sql (production, généré),
                          templates/ (emails de connexion FR), tests/rls.sql
docs/                     PLAN.md, LOT2-PLAN.md (lot 2), DEMANDES.md, AUDIT.md, DEPLOIEMENT.md (mise en ligne pas à pas),
                          DEMO.md, videos/storyboard.md, design/, references/ (modèles de feuilles de tirage)
```

## Règles d'architecture (non négociables)
- **Le sport est une configuration** : aucun `if (sport === 'petanque')` dans le moteur ni dans les composants partagés. Tout passe par `packages/sports` (nom des emplacements, formats, score, classement, licence, modèles de notifications, valeurs par défaut).
- **Couleurs** : uniquement dans `packages/ui/src/tokens.css` (variables `--os-*`, mappées en utilitaires Tailwind `bg-accent`, `text-ink`… dans `apps/web/src/app/globals.css`). Accent par sport via l'attribut `data-sport` (sur `<html>` ou sur un élément). Clair/sombre : système par défaut, choix mémorisé (`localStorage os_theme`) appliqué avant le premier affichage.
- **Moteur pur** : `applyCommand(état, commande, {now, newId, seed})` → `{state, changes}`. Aucune horloge, aucun hasard non contrôlé : les ids sont dérivés du `clientOpId`, les tirages d'une graine. Résultat identique sur le serveur et sur un appareil hors ligne.
- **Écriture en base** : uniquement via `executeCommand` (serveur) → RPC `apply_tournament_changes` (atomique, verrou optimiste `tournaments.state_version`, anti-doublon `client_op_id`). Chaque action est dans `tournament_actions` avec ses changements moteur ; annuler = appliquer l'inverse, refusé si une action plus récente touche les mêmes éléments (`conflictsWithLater`).
- **Pages « terrain »** (`/c/...`) : Route Handlers qui produisent du HTML (pas de runtime React côté client), lisibles sans JS, < 100 Ko (13 à 20 Ko mesurés), hors du `proxy`. CSS = tokens + `terrain.css`, généré par `scripts/build-terrain-css.mjs` (lancé avant dev/build/test). Pas de `gap` en flexbox, script ES5 : compatibles navigateurs anciens. Direct : WebSocket Supabase Realtime (diffusion `tournament:CODE`) sinon rafraîchissement 30 s ; service worker `public/sw.js` = dernier tirage lisible hors ligne.
- **Table de marque** : moteur exécuté dans le navigateur ; chaque saisie est appliquée tout de suite, gardée dans `localStorage` (`os_outbox_CODE`) et envoyée dans l'ordre jusqu'à confirmation. Témoin de connexion toujours visible. Accès : organisateur connecté ou PIN (cookie HMAC signé `STAFF_SESSION_SECRET`, 24 h, révocable). Seuls les échecs de PIN sont comptés (8 / appareil, 60 / concours par 15 min).
- **Données privées** : licences (`players_private`, `profiles_private`), contacts (`registrations`), PIN (`tournament_staff.pin_hash`, colonne non lisible par l'API). Le public ne lit jamais `players` directement : le serveur applique « noms complets / initiales » (`lib/names.ts`).
- **Publication** : un concours ne quitte `draft` que via le serveur (rôle service = webhook Stripe), garanti par un trigger SQL.
- **Paiement** : activation uniquement par webhook Stripe signé ; aucune donnée bancaire chez nous ; prix en base (`pricing_plans`). Le formulaire est figé sur la ligne `payments` (`form_snapshot`) au moment du paiement ; `publish_tournament` (SQL, rôle service, idempotent) le transforme en concours publié. Sans clé Stripe et hors production : « paiement simulé » local qui passe par le même webhook signé.
- **Notifications** : les changements du moteur deviennent des événements → file `notifications` (clé anti-doublon) → Web Push, sinon email de secours. Permission du navigateur demandée **seulement au clic** sur « Me prévenir ».
- **IA** : appelée seulement côté serveur ; les infos officielles viennent toujours de la base.
- **Aucun secret dans le code** : variables d'environnement, voir `.env.example`. `apps/web/.env.local` (ignoré par git) contient les clés locales de démo.

## Conventions
- Code et noms techniques en anglais ; **textes d'interface en français dans `src/i18n/fr.ts`**.
- Statuts concours : `draft → published → registration_closed → check_in → live → finished → archived`. `finished` = corrections encore possibles ; `archived` = clos définitivement (`tournament.close`), plus rien n'est accepté, annulation comprise.
- Codes courts : 4 caractères, alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sans 0/O/1/I/L), générés par la base.
- Heures affichées à la française : « 15 h 40 » (`lib/format.ts`, fuseau Europe/Paris).
- Préférences de l'appareil (invités compris) en cookies `os_prefs`, `os_sport`, `os_onboarded` → le serveur personnalise dès le premier rendu.
- Le seed est **généré** : modifier `packages/db/scripts/generate-seed.ts` puis `pnpm seed:gen && pnpm db:reset`.
- Après une migration : `pnpm db:types` pour régénérer les types.
- Fin de phase : `pnpm -r test`, `pnpm test:db`, `pnpm test:e2e`, `pnpm build`, captures, résumé, mise à jour de ce fichier, commit + push.
- Les tests e2e remettent la base à zéro au démarrage (`e2e/global-setup.ts`) ; `E2E_SKIP_RESET=1` pour l'éviter.
- Données de production : modifier `reference-data.ts` / `kb-content.ts` puis `pnpm --filter @orgasport/db reference:gen`.

## Commandes
```
pnpm install
pnpm db:start          # Supabase local (Docker). Voir README si Docker Hub limite les téléchargements.
pnpm db:reset          # migrations + seed de démo
pnpm dev               # http://localhost:3000
pnpm -r test           # tests unitaires
pnpm test:db           # tests de sécurité (RLS) en SQL
pnpm test:e2e          # parcours Playwright (lance le serveur si besoin)
pnpm videos:render     # rend les 4 vidéos (long : ~15 min chacune)
```
Variables locales nécessaires dans `apps/web/.env.local` : voir `.env.example` (dont `STAFF_SESSION_SECRET`, `CRON_SECRET`). Les tests Playwright lisent ce fichier (aucune clé dans les tests).
Comptes de démo (local uniquement, mot de passe `orgasport-demo`) : `joueur@demo.orgasport.fr`, `club@demo.orgasport.fr`, `benevole@demo.orgasport.fr`, `admin@demo.orgasport.fr`. PIN table de marque du concours 7KQ2 : `4821`.
Codes de démo (tous en pétanque, détail dans `docs/DEMO.md`) : `7KQ2` (en cours, 32 doublettes dont 3 absentes, tour « Cadrage » avec une équipe « Office », concours B, équipes « N.H. »), `GP3M` (à venir, inscriptions ouvertes), `TR8E` (terminé il y a 3 jours), `C4DR` (terminé, cadrage dans A, B et C), `2J7P` (2 jours, en pause avant les 1/4), `PQ8P` (à venir, en poules, tirage automatique des e2e). Codes promo de démo : `BIENVENUE` (100 %), `CLUB50`. Boîte mail locale : http://127.0.0.1:54324.

## Hors périmètre (place réservée)
CGV, mentions légales, confidentialité, cookies (pages vides `/legal/*` + table `legal_pages`), paiement en ligne des inscriptions, SMS (`notification_channel` 'sms', désactivé), app native, import Facebook/affiche par IA.

## Décisions prises par défaut (au fil des phases)
- Hébergement : Netlify gratuit (Vercel Hobby interdit l'usage commercial) — à revérifier au déploiement.
- Météo : MET Norway (Open-Meteo gratuit = non commercial). PayPal : via Stripe.
- i18n maison (`src/i18n`) plutôt que next-intl : un seul fichier par langue, aucune dépendance aux en-têtes de requête (compatible Cache Components et pages terrain légères).
- Police : Saira variable, auto-hébergée (`apps/web/src/fonts`, licence OFL) — pas d'appel à Google Fonts. Allégée par `scripts/subset-fonts.py` : texte droit en largeur normale (38 Ko), titres italiques 50–75 % (41 Ko).
- Géocodage : Géoplateforme IGN via `/api/geocode` ; si le service ne répond pas, la saisie libre est conservée.
- Notifications : à l'inscription on enregistre seulement l'accord de principe (`notifications_opt_in`) ; la demande d'autorisation du navigateur viendra au bon moment (phase 5), jamais à la première visite.
- Onboarding : préférences d'abord, compte à la fin (facultatif pour joueur/invité, obligatoire pour un club, placé avant l'étape logo). Brouillon gardé dans `localStorage os_onboarding` pour survivre au lien magique.
- « Retrouver mon tirage » : formulaire GET vers `/tirage/aller` (vraie redirection HTTP, fonctionne sans JS) ; scan QR via `BarcodeDetector`, sinon décodeur `jsqr` chargé à la demande.
- « Mon tirage » ouvre directement le prochain match si le joueur connecté joue un concours en cours (`?saisir=1` pour forcer la saisie d'un code).
- Licence : vérification du format uniquement (regex par sport), jamais affichée publiquement.
- Logo club : bucket public `club-logos`, envoi par le serveur après contrôle d'appartenance (2 Mo max).
- Phase 2 — formats : élimination avec **nouveau tirage à chaque tour** par défaut en pétanque (tableau fixe en option) ; un exempt par tour impair, jamais deux fois la même équipe si possible ; en tableau fixe les exempts vont aux mieux placés pour atteindre une puissance de 2. (Remplacé en pétanque par le **cadrage** du lot 2, voir plus bas.)
- Phase 2 — complémentaire : perdants d'**un** tour choisi (`consolation.losersOfRound`, 1 par défaut) ; en poules, les non-qualifiés. Tiré automatiquement dès que ce tour est complet. (Devenu le concours B du lot 2.)
- Phase 2 — poules : poules de 4 « en 3 parties » (gagnants / perdants / barrage) pour la pétanque, chacun contre chacun pour le foot ; poules de 3 quand le nombre ne tombe pas juste ; 2 qualifiés par poule ; phase finale en tableau fixe, vainqueurs de poule têtes de série, jamais deux équipes d'une même poule au 1er tour.
- Phase 2 — mêlée tournante : nouvelles équipes à chaque partie en évitant les mêmes partenaires ; les joueurs en surnombre sont exempts (comptés comme victoire) à tour de rôle.
- Phase 2 — forfait et exempt : score de forfait par défaut = cible du sport à 0 (13–0 en pétanque, 3–0 en foot), configurable (`forfeitScore`). Lot 2 : l'exempt a son propre score (`byeScore`, 13–7 en pétanque).
- Phase 2 — terrains : file « premier arrivé, premier servi » ; terrains réservés utilisables seulement à partir des demi-finales du tableau principal (`reservedVenuesFrom`) ; foot = créneaux horaires (aucune équipe sur deux matchs à la fois).
- Phase 2 — corrections : changer un vainqueur est accepté tant que les matchs suivants concernés ne sont pas joués (sinon message « annulez d'abord… ») ; en poules, refusé si le tableau final est déjà tiré et que les qualifiés changeraient.
- Phase 2 — scores capitaines : option `scoreEntry: "captains"` ; code équipe à 4 chiffres (`team_secrets`, visible par la table de marque et sur la liste imprimée) ; validé si les deux capitaines saisissent le même score, sinon « à vérifier » par la table.
- Phase 2 — « C'est mon équipe » : cookie `os_t_CODE` (30 jours) sur l'appareil, sans compte ; l'équipe est ensuite mise en avant automatiquement.
- Phase 2 — tirage automatique : `config.autoDrawAt` ; à brancher en production sur un appel minute de `/api/cron/tick` (Supabase pg_cron ou service gratuit), avec en filet de sécurité un déclenchement après l'affichage de la page publique.
- Environnement de dev cloud : Docker Hub limite les téléchargements anonymes ; `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` et relances. Le géocodage IGN est bloqué par le réseau de cet environnement (pas en production).
- Phase 3 — formulaire « Créer un concours » : 8 étapes, tout prérempli par le sport, brouillon enregistré tout seul (`tournaments.draft_form`, effacé à la publication) ; conseiller de format (terrains nécessaires, heure de fin). Prix choisi par `pickPlan` (le plus petit plan qui convient) ; code promo dans sa propre table, essais limités (10 échecs / heure) ; reste < 0,50 € → gratuit (minimum Stripe).
- Phase 3 — membres de club : invitation par lien (20 / jour), le propriétaire ne peut être ni modifié ni retiré ; les clients ne modifient que les brouillons (RLS), tout le reste passe par le serveur.
- Phase 4 — inscription en ligne : page terrain sans JS, moteur `team.create` (`source: "online"`, refus si complet sauf liste d'attente), contacts dans `registrations` via `register_team_private` ; anti-robots Turnstile obligatoire en production (refus si les clés manquent) ; fichier `.ics` ; météo MET Norway sur la page détail.
- Phase 5 — fil « Pour vous » : éléments classés par une fonction pure (`lib/feed/rank.ts` : en direct, sport, distance, date, suivis) ; actualités = titre + lien vers la source seulement (jamais le texte), flux RSS ajoutés dans l'admin, téléchargement protégé (pas d'adresse privée, 1 Mo, 8 s).
- Phase 5 — notifications : PWA installable (`manifest.webmanifest` ; `terrain.webmanifest` pour qu'une page concours ajoutée à l'écran d'accueil rouvre sur l'équipe, nécessaire au push sur iPhone) ; aide pas à pas sur iPhone ; équipes suivies sans compte en `localStorage os_push_teams` ; emails de secours désactivables dans le profil.
- Phase 6 — assistant : boucle d'outils manuelle en streaming, outils côté serveur (concours, prochain match, inscrits, conseil de format, base de connaissances), effort bas ; quotas par jour (invité 5, compte 20, club payant 100) et budget mensuel (20 €) réglables dans `/admin/assistant` ; sans clé API il répond avec la base de connaissances, sans se faire passer pour l'IA. Bulle chargée seulement à l'ouverture ; conversation en `sessionStorage`.
- Phase 7 — vidéos : tutoriel entièrement en plans 3D (écrans flottants, cartes en profondeur), palette bleu et noir ; rendues une fois (MP4 H.264, sous-titres WebVTT) et servies comme fichiers ; image d'aperçu seulement, la vidéo n'est téléchargée qu'au clic ; version verticale choisie au clic sur un téléphone tenu droit.
- Couleurs : bleu et noir uniquement (accent bleu électrique, football en bleu cyan) ; rouge/vert/orange réservés aux états. L'accueil est une scène sombre dans les deux thèmes (`[data-scheme="stage"]` dans tokens.css).
- Phase 8 — accueil : scène 3D plein écran (boulodrome néon, caméra liée au défilement et au pointeur), boule de pétanque réaliste **sans aucune marque** (acier satiné, rainures, rayures) ↔ ballon, en three.js, chargée après l'affichage, seulement si l'appareil est assez puissant, sans « réduire les animations » ni économie de données ; sinon images fixes pré-rendues (`public/vitrine/*.webp`, `scripts/render-hero-balls.mjs`). En-têtes de sécurité sur toutes les routes (`next.config.ts`). Tâches planifiées en production : Supabase `pg_cron` + `pg_net` (voir `docs/DEPLOIEMENT.md`).
- Emails de connexion Supabase en français : `supabase/templates/` (générés par `scripts/build-auth-emails.ts`), à copier dans le tableau de bord Supabase en production.

## Décisions du lot 2 (`docs/LOT2-PLAN.md`)
- **Pétanque seule** : `enabled: false` dans `packages/sports/src/sports/football.ts` (code du football conservé, filtré par `enabledSports()`). Réactiver = remettre `enabled: true`, `pnpm --filter @orgasport/db reference:gen`, relancer `reference.sql` en production, puis revoir les tests e2e « pétanque seule ».
- **Cadrage** (`config.cadrage.afterRound`, 1 par défaut) : avant, tirage intégral au hasard (un exempt si nombre impair, score 13–7) ; au cadrage, si T équipes n'est pas une puissance de 2 (P = la plus grande en dessous), T−P parties et 2P−T équipes qualifiées d'office, affichées face à « **Office** » (partie « bye » à un seul côté, tour `rounds.kind = 'cadrage'`). Ensuite toujours une puissance de 2 (un double forfait crée des places d'office). Même règle pour la phase finale après poules, le B et le C. « Même club évité » seulement au premier tirage de chaque tableau.
- **Concours B et C** : B = perdants de la 1re partie du A (sans l'exempt) ou non-qualifiés des poules ; C = perdants de la 1re partie du B, possible seulement si le B a au moins 4 équipes. Inscription `auto` (défaut pétanque : B activé, C désactivé) ou `opt_in` : seules les équipes inscrites par `team.enterBracket` jouent, 1er tirage manuel par la table, droit d'inscription affiché à titre d'information (aucun paiement en ligne).
- **N.H.** : club des joueurs public (`players.club_number`, `club_name`) ; même club pour tous = « (n°/CLUB) », clubs différents = « (N.H.) » sans contrainte de club au tirage (`teamAffiliation`).
- **2 jours** : `config.pause` (`{before: {remaining}}`, `"afterPools"`, `{afterRound}`) ; aucun tirage automatique du A, du B ni du C tant que la table n'a pas fait « Reprendre le concours » (`tournament.resume`) ou un tirage manuel. Le statut reste `live`, aucune heure de fin calculée. Une partie du dernier tour rouverte la nuit met ce tour au statut **`live`** (= joué jusqu'au bout puis rouvert, affiché comme « tiré ») : la pause tient toujours (`isPauseHeld`, bandeau « Concours en pause » de la table). « Reprise demain » n'est envoyé qu'aux équipes encore en lice.
- **Lien à usage unique** : en `finished`, seules les corrections (score, forfait, réouverture, annulation) ; bouton « Clore définitivement » ou clôture automatique **24 h** après `tournaments.finished_at` (`/api/cron/tick`) ; en `archived` tout est refusé (inscriptions, scores des capitaines, table de marque, abonnements push), avec un message clair.
- **Suppression des données** : `purge_finished_tournaments()` (SQL, idempotente) **14 jours** après la finale d'un concours clos, et en filet **6 mois** après le début de tout concours publié (clos d'office) : joueurs, contacts, codes d'équipe, PIN, historique, notifications et abonnements ; noms d'équipes anonymisés. Gardés : paiements, factures, ligne `tournaments` (code jamais réattribué). La page publique affiche « Résultats supprimés ». Production : pg_cron chaque nuit + `/api/cron/tick` (voir `docs/DEPLOIEMENT.md`).
- **PIN bénévole** : explication en 3 étapes (créer, donner, saisir) là où on crée le PIN et sur l'écran de saisie ; « PIN de la table » unique proposé par défaut ; fiche à imprimer (QR code vers `/c/CODE/table` sans le PIN dans l'adresse, PIN en grand).
- **Hors ligne** : pages terrain gardées par le service worker (dernier tirage reçu, page des équipes) ; bouton « Enregistrer pour hors ligne » = fichier `.html` autonome (CSS intégré, sans script ni formulaire, daté, liens absolus vers le site) ; impression façon feuilles de résultats. Table de marque : Chrome ou Edge 109 ou plus (Windows 7 compris), Firefox ESR 115 ou plus, Safari 16.4 ou plus. Ouvrir la table une fois avec du réseau avant le concours. Navigateur plus ancien : feuilles imprimées. (Pas de couleur translucide `/NN` dans la table — `color-mix()` absent avant Chrome 111 — : jetons pleins `--os-*-soft`, vérifié par `no-translucent-colors.test.ts`.)
- **Aucune heure de fin** ni estimation de durée affichée nulle part.
- **Base de connaissances datée** : chaque fiche porte une date (« Fiche d'aide à jour au … », « règlement en vigueur au … ») ; `reference.sql` ne date une fiche d'aide que si son texte en base est exactement l'actuel (empreinte md5) et n'écrase jamais un texte modifié dans l'admin ; alerte dans `/admin/assistant` pour un règlement non relu depuis 12 mois. Pas de recherche web.
- **Démo** : pétanque uniquement, plus de FT8S. Les concours terminés de la démo n'ont pas de `finished_at` : ils ne sont jamais clos ni purgés automatiquement.
