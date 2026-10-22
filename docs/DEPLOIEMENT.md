# Mettre OrgaSport en ligne

Ce guide explique, étape par étape, comment passer de la démo locale à un vrai site.
Comptez **2 à 3 heures** la première fois. Tous les services cités ont une offre gratuite
suffisante pour démarrer, sauf Stripe (commission sur chaque paiement) et l'assistant IA
(quelques centimes par jour, plafonnés).

> Règle d'or : **aucune clé ne va dans le code**. Chaque clé se colle dans l'interface du
> service concerné (Netlify ou Supabase). Le fichier `.env.example` liste et explique
> toutes les variables.

Vous aurez besoin de créer un compte sur :
[GitHub](https://github.com) (déjà fait), [Netlify](https://www.netlify.com),
[Supabase](https://supabase.com), [Stripe](https://stripe.com/fr),
[Resend](https://resend.com), [Cloudflare](https://dash.cloudflare.com) (anti-robots, gratuit)
et [Anthropic](https://console.anthropic.com) (assistant).

Il vous faut aussi un **nom de domaine** (ex. `orgasport.fr`, environ 10 € par an chez OVH,
Gandi…) : les emails ne peuvent pas partir d'une adresse que vous ne possédez pas.

---

## Étape 1 — La base de données (Supabase)

1. Sur [supabase.com](https://supabase.com) : **New project**. Région : **Paris (eu-west-3)**.
   Notez le mot de passe de la base dans un gestionnaire de mots de passe.
2. Sur votre ordinateur, dans le dossier du projet :
   ```bash
   npx supabase login
   npx supabase link --project-ref VOTRE_REF   # la « ref » est dans l'adresse du projet
   npx supabase db push                        # crée toutes les tables et la sécurité
   ```
3. Données de départ (sports, prix, réglages, base de connaissances de l'assistant —
   **sans** les comptes de démo) : ouvrez **SQL Editor**, collez le contenu du fichier
   `supabase/reference.sql` et cliquez **Run**. Ce fichier peut être relancé sans risque
   après chaque mise à jour (il ne touche pas aux prix que vous avez modifiés).
   - Pour le régénérer après une modification d'un sport : `pnpm --filter @orgasport/db reference:gen`.
4. **Project Settings > API Keys** : notez l'adresse du projet (`https://xxxx.supabase.co`),
   la clé **publishable** et la clé **secret**.

> ⚠️ N'exécutez **jamais** `supabase/seed.sql` en production : il contient des comptes de
> démo avec un mot de passe connu.

## Étape 2 — Les emails (Resend)

1. Sur [resend.com](https://resend.com) : **Domains > Add domain**, entrez votre domaine,
   puis ajoutez chez votre registraire les enregistrements DNS affichés (SPF, DKIM).
   Attendez le statut **Verified** (quelques minutes à quelques heures).
2. **API Keys > Create API key** (droit « Sending access ») : notez la clé (`re_…`).
3. Les emails de **connexion** sont envoyés par Supabase : dans Supabase,
   **Authentication > Emails > SMTP Settings**, activez « Custom SMTP » :
   - Host `smtp.resend.com`, port `465`, utilisateur `resend`, mot de passe = la clé `re_…`
   - Expéditeur : `noreply@votre-domaine.fr`, nom : `OrgaSport`
4. Toujours dans **Authentication > Emails > Templates**, remplacez les modèles anglais par
   les nôtres (copier-coller du fichier, et l'objet indiqué) :

   | Modèle Supabase | Objet | Fichier |
   |---|---|---|
   | Magic Link | Votre lien de connexion OrgaSport | `supabase/templates/magic_link.html` |
   | Confirm signup | Bienvenue sur OrgaSport : confirmez votre adresse | `supabase/templates/confirmation.html` |
   | Reset Password | Réinitialiser votre mot de passe OrgaSport | `supabase/templates/recovery.html` |
   | Change Email Address | Confirmez votre nouvelle adresse email | `supabase/templates/email_change.html` |

## Étape 3 — Le site (Netlify)

1. Sur [Netlify](https://app.netlify.com) : **Add new project > Import an existing project**,
   choisissez GitHub puis le dépôt OrgaSport.
2. Réglages de construction :
   - **Base directory** : laisser vide
   - **Package directory** : `apps/web`
   - Le reste est lu dans `apps/web/netlify.toml` (commande `pnpm build`, Node 22).
3. **Site configuration > Environment variables** : ajoutez les variables ci-dessous
   (bouton « Add a variable », une par une). Les valeurs viennent des étapes 1, 2, 4 à 7.

   | Variable | Valeur |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://votre-domaine.fr` (sans `/` final) |
   | `NEXT_PUBLIC_SUPABASE_URL` | adresse du projet Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clé publishable |
   | `SUPABASE_SECRET_KEY` | clé secret (cochez « Contains secret values ») |
   | `STAFF_SESSION_SECRET` | une longue chaîne aléatoire (voir ci-dessous) |
   | `CRON_SECRET` | une **autre** longue chaîne aléatoire |
   | `RESEND_API_KEY` | clé `re_…` |
   | `EMAIL_FROM` | `OrgaSport <noreply@votre-domaine.fr>` |
   | `STRIPE_SECRET_KEY` | étape 4 |
   | `STRIPE_WEBHOOK_SECRET` | étape 4 |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | étape 5 |
   | `VAPID_SUBJECT` | `mailto:contact@votre-domaine.fr` |
   | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | étape 6 |
   | `ANTHROPIC_API_KEY` | étape 7 |
   | `WEATHER_USER_AGENT` | `OrgaSport/1.0 (+https://votre-domaine.fr)` |

   Pour fabriquer une longue chaîne aléatoire : `openssl rand -hex 32` dans un terminal
   (ou un générateur de mots de passe, 64 caractères).
4. **Domain management** : ajoutez votre domaine et suivez les indications DNS.
   Le certificat HTTPS est automatique.
5. **Deploys > Trigger deploy**. Après chaque ajout ou modification de variable,
   redéployez pour qu'elle soit prise en compte.

> Si le site se construit mais affiche une erreur « Cannot find module 'next/…' » :
> ajoutez la variable `PNPM_FLAGS` = `--shamefully-hoist` et redéployez.

Enfin, dans Supabase, **Authentication > URL Configuration** :
- **Site URL** : `https://votre-domaine.fr`
- **Redirect URLs** : `https://votre-domaine.fr/**`

## Étape 4 — Les paiements (Stripe)

Commencez en **mode test** (interrupteur « Test mode » en haut du tableau de bord Stripe) :
aucun vrai paiement, cartes de test `4242 4242 4242 4242`.

1. **Développeurs > Clés API** : copiez la **clé secrète** (`sk_test_…`) → `STRIPE_SECRET_KEY`.
2. **Développeurs > Webhooks > Ajouter une destination** :
   - Adresse : `https://votre-domaine.fr/api/stripe/webhook`
   - Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Copiez le **secret de signature** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
3. **Paramètres > Moyens de paiement** : activez Carte, Apple Pay, Google Pay et,
   si vous le souhaitez, PayPal. OrgaSport ne voit jamais les numéros de carte.
4. Redéployez sur Netlify, créez un concours et payez avec la carte de test :
   il doit passer « en ligne » en quelques secondes.
5. Pour encaisser pour de vrai : complétez le profil de l'entreprise dans Stripe, passez en
   mode **live**, refaites les points 1 et 2 avec les clés live (`sk_live_…`, nouveau
   `whsec_…`), remplacez-les sur Netlify, redéployez.

Les prix se règlent dans l'administration du site : **/admin/tarifs**.

## Étape 5 — Les notifications sur téléphone (Web Push, gratuit)

Dans un terminal : `npx web-push generate-vapid-keys`. Collez la « Public Key » dans
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` et la « Private Key » dans `VAPID_PRIVATE_KEY`.
Ne changez plus jamais cette paire : sinon tous les abonnements existants sont perdus.

## Étape 6 — L'anti-robots (Cloudflare Turnstile, gratuit)

1. Cloudflare > **Turnstile > Add widget** : nom « OrgaSport », domaine `votre-domaine.fr`,
   mode « Managed ».
2. **Site key** → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ; **Secret key** → `TURNSTILE_SECRET_KEY`.
3. Collez aussi la Secret key dans Supabase, **Authentication > Attack Protection >
   Enable CAPTCHA protection** (fournisseur Turnstile) : elle protège la création de comptes.

En production, l'inscription en ligne aux concours est **refusée** tant que ces clés manquent
(protection contre les inscriptions automatiques).

## Étape 7 — L'assistant (Anthropic)

1. [console.anthropic.com](https://console.anthropic.com) : **API Keys > Create Key** →
   `ANTHROPIC_API_KEY`.
2. **Settings > Limits** : fixez une limite de dépense mensuelle (ex. 20 $). L'administration
   du site a aussi son propre plafond (**/admin/assistant**), qui coupe l'assistant avant.
3. Sans clé, l'assistant reste utilisable : il répond avec la base de connaissances du site.

## Étape 8 — Les tâches automatiques (chaque minute)

Tirages à l'heure prévue, rappels et envoi des notifications passent par l'adresse
`/api/cron/tick`, à appeler chaque minute. Le plus simple : Supabase s'en charge.

1. Supabase > **Database > Extensions** : activez `pg_cron` et `pg_net`.
2. **SQL Editor** : collez ce texte en remplaçant les deux valeurs, puis **Run** :
   ```sql
   select vault.create_secret('https://votre-domaine.fr/api/cron/tick', 'orgasport_tick_url');
   select vault.create_secret('LA_VALEUR_DE_CRON_SECRET', 'orgasport_cron_secret');

   select cron.schedule('orgasport-tick', '* * * * *', $$
     select net.http_get(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'orgasport_tick_url'),
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name = 'orgasport_cron_secret')),
       timeout_milliseconds := 25000
     );
   $$);
   ```
   Les actualités (flux RSS ajoutés dans **/admin/actualites**) se récupèrent une fois par heure :
   ```sql
   select vault.create_secret('https://votre-domaine.fr/api/cron/news', 'orgasport_news_url');

   select cron.schedule('orgasport-news', '17 * * * *', $$
     select net.http_get(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'orgasport_news_url'),
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name = 'orgasport_cron_secret')),
       timeout_milliseconds := 60000
     );
   $$);
   ```
   La suppression des données personnelles (noms, contacts, codes d'équipe, PIN, historique) des
   concours clos depuis plus de 14 jours tourne une fois par jour, directement dans la base
   (la tâche de chaque minute la lance aussi, par sécurité ; elle ne fait rien deux fois) :
   ```sql
   select cron.schedule('orgasport-purge', '23 3 * * *', $$ select public.purge_finished_tournaments(); $$);
   ```
   Les paiements, les factures et le code court du concours sont conservés ; la page publique
   affiche alors « Résultats supprimés ».
3. Vérification au bout de 2 minutes :
   `select status_code, content from net._http_response order by created desc limit 3;`
   doit afficher `200` et `{"drawn":…}`.

Pour les arrêter : `select cron.unschedule('orgasport-tick');`, `select cron.unschedule('orgasport-news');` et `select cron.unschedule('orgasport-purge');`

## Étape 9 — Votre compte administrateur

1. Sur le site en ligne, créez votre compte normalement (Connexion > recevoir un lien).
2. Supabase > **SQL Editor** :
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'votre-adresse@exemple.fr';
   ```
3. Rechargez le site : un lien **Administration** apparaît dans **Profil** (`/admin`) : tarifs, codes promo,
   paiements, concours, assistant, actualités.

## Étape 10 — Avant d'ouvrir au public

- [ ] Pages légales rédigées (mentions légales, CGV, confidentialité, cookies) : elles existent,
      vides, dans la table `legal_pages` (à faire relire par un professionnel).
- [ ] Un concours de test créé, payé (mode test), joué depuis la table de marque et un téléphone.
- [ ] Notification reçue sur un téléphone (Android et iPhone ajouté à l'écran d'accueil).
- [ ] Stripe passé en mode live.
- [ ] Sauvegardes : l'offre gratuite de Supabase n'en propose pas au téléchargement (l'offre Pro,
      payante, en fait une par jour). Pour démarrer, faites un export chaque semaine :
      `npx supabase db dump --linked -f sauvegarde-AAAA-MM-JJ.sql` (fichier à garder hors du dépôt).
- [ ] Facturation Netlify : l'offre gratuite fonctionne avec des « crédits » mensuels ; le site
      est mis en pause s'ils sont épuisés. Surveillez **Usage** les premières semaines et
      passez à l'offre payante si besoin.
- [ ] Cache des pages concours (rafraîchissements `?fragment=1`) : remplacez `CODE` par le code d'un concours
      publié et `SITE` par l'adresse du site, puis vérifiez dans un terminal :
      1. sans cookie, deux appels à moins de 4 s d'écart :
         `curl -sI "https://SITE/c/CODE?fragment=1" | grep -i -E "cache-status|cache-control|vary"`
         → le 2ᵉ indique `"Netlify Edge"; hit` dans `Cache-Status` ;
      2. avec le cookie d'équipe, juste après :
         `curl -sI -H "Cookie: os_t_CODE=3" "https://SITE/c/CODE?fragment=1" | grep -i -E "cache-status|cache-control"`
         → jamais `hit`, et `Cache-Control: no-store`.
      Si le 2ᵉ appel renvoie `hit` : supprimer le cache de 4 s (`s-maxage`) dans
      `apps/web/src/terrain/cache-headers.ts` et redéployer.
- [ ] Refaire la mesure de charge avec 2 000 téléphones sur un concours de 512 équipes
      (`/c/CODE?fragment=1`, 2 000 requêtes simultanées, attente médiane et maximale) sur le site en ligne :
      avant correction, en local, la médiane était de 5,1 s et le maximum de 18,9 s. Objectif : médiane < 2 s,
      maximum < 10 s. À faire sur un concours de test (jamais un vrai concours en cours).

## Mettre à jour le site ensuite

- Chaque `git push` sur la branche principale redéploie le site automatiquement.
- Si une mise à jour contient une nouvelle migration (`supabase/migrations/`) :
  `npx supabase db push`, **avant** le déploiement.
- Si les sports ou la base de connaissances ont changé : relancez `supabase/reference.sql`.
  Une fiche d'aide déjà en base n'est jamais réécrite (un texte modifié dans l'admin est gardé) : après la mise
  à jour, ouvrez `/admin/assistant` et recopiez ou relisez les fiches **sans date** de mise à jour (leur texte
  n'est plus celui du site), puis datez-les.
