# Déploiement et intégration continue

Deux machines regardent chaque poussée, et elles ne gardent pas la même chose.

| Machine                   | Se déclenche sur                        | Exécute                                        | Ce qu'elle empêche                              |
| ------------------------- | --------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| GitHub Actions (`ci.yml`) | pull request, push sur `main`/`develop` | toute la chaîne de vérifications               | **la fusion**                                   |
| Vercel                    | toute poussée, toute branche            | `validate:content`, `build`, puis `test:build` | qu'un contenu fautif ou un brouillon soit servi |

Elles sont **indépendantes** : Vercel n'attend pas le pipeline et n'en connaît pas
l'existence. Une prévisualisation est donc en ligne pendant que le pipeline tourne
encore, et le reste s'il finit rouge. Ce n'est pas un défaut de réglage, c'est le
dispositif : la prévisualisation doit arriver vite. Ce qui protège la production,
c'est que la production ne part que de `main`, qu'on n'atteint `main` que par une
fusion, et qu'une fusion est refusée si le pipeline est rouge.

**Pourquoi `test:build` tourne aussi chez Vercel, alors que le pipeline le fait
déjà.** Ce n'est pas une redondance : les deux machines ne voient pas la même
chose. Le garde des brouillons dépend de la configuration du **déploiement** —
`TIW_DRAFTS`, posé dans le tableau de bord Vercel — et cette variable n'existe pas
sur le runner GitHub. La seule machine qui puisse constater qu'un brouillon part en
ligne est donc celle qui construit le déploiement. Mesuré : `test:build` ajoute
moins d'une seconde à un build Vercel, et il lit `.next/` sur le même disque, d'où
sa place en fin de chaîne.

Le raisonnement complet, les alternatives pesées et ce qui invaliderait ce choix
sont dans [`adr/0004-la-ci-garde-la-fusion-pas-le-deploiement.md`](adr/0004-la-ci-garde-la-fusion-pas-le-deploiement.md).

## Le pipeline

`.github/workflows/ci.yml`, quatre jobs : trois en parallèle, un qui les agrège.

| Job                                     | Ce qu'il exécute                                             | Sur le runner |
| --------------------------------------- | ------------------------------------------------------------ | ------------- |
| `Lint, types, contenu, tests unitaires` | `lint`, `typecheck`, `validate:content`, `test`, `test:lint` | 54 s          |
| `Build, prérendu et budgets`            | `build` puis `test:build`                                    | 34 s          |
| `Playwright (build de production)`      | installation de Chromium puis `test:e2e`                     | 73 s          |
| `Vérifications`                         | rien — refuse si l'un des trois n'a pas réussi               | 4 s           |

Mesuré sur `ubuntu-latest` : **83 s de bout en bout à caches froids, 67 s à caches
chauds** — le job le plus long plus l'agrégat, et non la somme des trois, ce qui est
exactement ce qu'on achète avec le parallélisme. Les durées de la colonne sont
celles du premier run ; le job Playwright passe de 73 s à 57 s une fois Chromium en
cache.

Trois points qui ne se devinent pas en lisant le fichier :

**`test:build` est dans le job du build, pas ailleurs.** Il lit
`.next/prerender-manifest.json` et pèse les chunks de `.next/static` : il lui faut
l'artefact réel, sur le même disque. C'est la seule vérification automatique de
l'invariant central du projet — un prérendu qui disparaît laisse `next build`
sortir en code 0 avec un `✓ Generating static pages` rassurant. Il n'est ni
`continue-on-error`, ni conditionnel, ni sautable.

**L'E2E est un job à part alors qu'il pourrait être une étape du build**, parce que
`playwright.config.ts` reconstruit tout : son `webServer` lance
`npm run build && npm run start` avec `reuseExistingServer: false`, propriété
délibérée — avec la réutilisation, la suite s'était accrochée au `next dev` du
poste et passait au vert contre du HTML de développement, sans aucun build.

On paie donc **deux builds**, et c'est l'option la moins chère. Le job tourne _à
côté_ de `build`, pas après : le second build se paie en minutes de runner
(gratuites, dépôt public) et en **zéro** seconde de latence de retour. Les deux
alternatives coûtent plus. Ajouter ces étapes au job `build` paierait les deux
builds en série. Servir à Playwright un serveur déjà construit demanderait
d'affaiblir `reuseExistingServer: false`, c'est-à-dire d'échanger une garde
prouvée contre une quarantaine de secondes.

Ce qui mérite en revanche d'être mutualisé, c'est le téléchargement du navigateur,
absent du poste comme du runner. Il est mis en cache sous
`~/.cache/ms-playwright`, **clé = version de Playwright installée**, pas empreinte
du lockfile : le binaire attendu est épinglé à cette version, et un cache qui sert
l'autre est une instabilité que personne ne remonte jusqu'ici. Piège associé, d'où
les deux étapes conditionnelles du workflow : `--with-deps` installe aussi des
paquets apt sur l'image du runner, qui ne sont **pas** dans ce dossier. Un cache
touché exige donc quand même `playwright install-deps`, sans quoi Chromium démarre
et meurt aussitôt sur une bibliothèque partagée manquante.

**`Vérifications` est le seul nom que la protection de branche connaît.** Si elle
listait les jobs un par un, un quatrième job ajouté demain serait consultatif :
rouge, visible, et la fusion passerait quand même jusqu'à ce que quelqu'un pense à
cocher une case dans une interface. La liste vit dans le `needs:` du workflow, donc
dans le dépôt, donc dans la revue.

## Ce qui reste à faire à la main

Les trois sections qui suivent ne sont pas automatisables depuis le dépôt : elles
passent par le compte Vercel, par une URL publique et par les réglages GitHub.
**Elles ne sont pas faites.** Tant qu'elles ne le sont pas, le workflow tourne et
affiche un résultat, mais rien ne bloque une fusion et rien n'est déployé.

### 1. Rattacher le projet Vercel

Dans l'ordre, sur <https://vercel.com>.

1. **Add New → Project → Import Git Repository.** Autoriser l'application GitHub
   Vercel sur le compte `ThoomassC`, puis choisir `travels_in_world`.
2. **Framework Preset** : `Next.js`, détecté seul. **Ne rien saisir dans « Build
   and Output Settings »** : `vercel.json` porte déjà `framework` et
   `buildCommand`, et un `vercel.json` prime sur le tableau de bord. Le laisser
   vide évite d'entretenir deux valeurs dont une seule s'applique.
3. **Environment Variables : aucune.** Le projet n'a aucun secret — le géocodage
   utilise `geocoding-api.open-meteo.com`, qui ne demande pas de clé, et il tourne
   sur le poste, pas au build. `TIW_GEOCODING_URL`, `TIW_CONTENT_DIR`,
   `TIW_PUBLIC_DIR` et `TIW_SLUG_HISTORY` sont des variables de test : elles n'ont
   rien à faire ici. `TIW_SITE_URL` non plus, et c'est le point le plus contre-intuitif
   de cette liste : l'origine du site se lit d'elle-même dans
   `VERCEL_PROJECT_PRODUCTION_URL`, que la plateforme pose sur chaque build, donc la
   déclarer à la main créerait une seconde vérité qui ne suivrait pas l'ajout d'un
   domaine. Elle n'existe que comme échappatoire pour un hôte que Vercel ne connaît
   pas. S'il faut un jour en ajouter une, elle se déclare par environnement
   (Production / Preview / Development) et **jamais** dans un fichier committé.
4. **Deploy.** Ce premier déploiement construit la branche par défaut du dépôt
   GitHub, qui est `develop` — voir l'étape suivante, à faire tout de suite après.
5. **Settings → Git → Production Branch : `main`.** Réglage obligatoire et
   non-défaut : la branche par défaut du dépôt est `develop`, donc Vercel prend
   `develop` comme branche de production si on ne touche à rien, et chaque fusion
   d'un ticket partirait en production. Après le changement, redéployer depuis
   `main` (Deployments → dernier déploiement de `main` → « Promote to Production »,
   ou une poussée sur `main`).
6. **Settings → Build and Deployment → Node.js Version : `24.x`.** Le défaut de la
   plateforme suit son propre calendrier et finira par s'écarter de `.nvmrc` et du
   champ `engines` du `package.json`. Les trois doivent dire la même chose : la CI
   lit `.nvmrc` (`node-version-file`), le poste aussi (`nvm use`), et ce réglage est
   le seul des trois qui ne soit pas dans le dépôt — donc le seul à vérifier à la
   main quand une version de Node change.
7. **Vérifier que les prévisualisations de branche sont actives.** Dans
   **Settings → Git**, aucun filtre de branche ne doit restreindre les
   déploiements (le comportement par défaut est « toutes les branches »), et
   **« Ignored Build Step » doit rester vide**. La vérification qui compte n'est pas
   dans les réglages : pousser une branche, ouvrir une pull request, et constater
   que Vercel commente l'URL de prévisualisation.

### Relire un brouillon sur une prévisualisation — ce que ça demande vraiment

Ce document a d'abord écrit que la prévisualisation était l'endroit où se relit un
voyage en `draft`. **C'est faux tel quel, et la mesure le dit :**
`VERCEL_ENV=preview npx next build` **masque** les brouillons, exactement comme un
build de production. Par défaut, un brouillon n'est visible qu'en développement
local (`npm run dev`).

Pour qu'une prévisualisation les montre, il faut poser `TIW_DRAFTS=visible` dans
**Settings → Environment Variables**, et deux précautions valent d'être connues
avant de le faire :

1. **Cocher la portée `Preview` uniquement.** Le formulaire d'ajout coche
   Production, Preview et Development **par défaut** : laissé tel quel, il publie
   les brouillons sur le site en ligne. Le code refuse désormais ce cas — la
   variable ne peut plus rien publier quand `VERCEL_ENV` vaut `production` — mais
   se reposer sur ce garde plutôt que sur la case cochée serait faire l'inverse de
   ce que ce dépôt fait partout ailleurs.
2. **Activer la Deployment Protection d'abord** (Settings → Deployment Protection →
   Vercel Authentication). Une URL de prévisualisation est **publique**, et Vercel
   la commente sur la pull request — d'un dépôt public. Sans cette protection,
   « relire un brouillon en privé » signifie le publier à qui lit la pull request.
3. **Domaine** : `*.vercel.app` suffit pour l'instant. Un domaine propre se règle
   dans **Settings → Domains** et demande un enregistrement DNS chez le
   registraire — hors périmètre de ce ticket.

### 2. Contrôler les aperçus de lien partagé

**Ceci n'a pas été fait et ne pouvait pas l'être : il faut une URL publique.** Le
dépôt livre les balises — `og:title`, `og:description`, `og:url`, `og:site_name`,
`og:locale`, `og:type`, `og:image` avec ses dimensions et son texte alternatif, les
`twitter:*` équivalentes, et une `<link rel="canonical">` par page — et elles sont
vérifiées localement sur le HTML prérendu par `tests/build/durable-urls.test.ts` et
sur le HTML servi par `tests/e2e/durable-urls.spec.ts`. Ce qu'aucun test ne peut
faire, c'est constater ce qu'une plateforme tierce **décide** d'afficher : chacune
applique ses propres règles de taille d'image, de longueur de titre et de cache.

À faire une fois le projet rattaché, dans cet ordre. Les deux premières lignes
suffisent à remplir le critère « au moins deux plateformes ».

1. **Facebook Sharing Debugger** — <https://developers.facebook.com/tools/debug/>.
   Coller `https://<domaine>/fr`, puis `https://<domaine>/fr/voyages`, puis l'URL
   d'un voyage publié. C'est l'outil le plus bavard des trois : il liste les balises
   qu'il a lues et **nomme** celles qui manquent. « Scrape Again » force la relecture
   — indispensable, son cache garde une première lecture plusieurs jours, et un
   aperçu qui reste faux après correction est presque toujours ce cache.
2. **LinkedIn Post Inspector** — <https://www.linkedin.com/post-inspector/>. Mêmes
   trois URL. LinkedIn a son propre cache, indépendant de celui de Facebook, et cet
   outil est la seule façon de le vider.
3. **Un vrai message, sur une application de messagerie.** Coller l'URL d'un voyage
   dans une conversation avec soi-même (WhatsApp, Signal, Telegram, iMessage) et
   regarder la carte se déplier. Ce n'est pas un pis-aller : le validateur de cartes
   de X/Twitter a été retiré, et une messagerie est de toute façon le chemin réel par
   lequel un lien de ce site circulera. Ce qu'il faut voir : le titre du voyage, la
   description, et la photo de couverture — **pas** un rectangle gris.
4. **Un voyage sans photo**, s'il en existe un. La carte attendue est un titre et une
   description **sans image** (`twitter:card` retombe sur `summary`), et c'est le
   comportement voulu : le dépôt ne génère pas d'image de partage, pour les raisons
   mesurées que le README détaille. Une carte vide avec un cadre d'image béant est la
   régression à guetter ici.
5. **Google Search Console**, si le site doit être indexé : ajouter la propriété du
   domaine, soumettre `https://<domaine>/sitemap.xml`, puis utiliser l'inspection
   d'URL sur `/fr/voyages/<un-voyage>` pour vérifier que la canonique que Google
   retient est bien celle que la page déclare.

Vérifier aussi, à la main et une seule fois, que `https://<domaine>/robots.txt`
nomme le sitemap avec le bon domaine, et que `https://<domaine>/sitemap.xml` ne
contient que des voyages publiés. Les deux sont prérendus au build : s'ils portent le
mauvais domaine, c'est que `VERCEL_PROJECT_PRODUCTION_URL` n'était pas ce qu'on
croyait, et le seul fichier à regarder est `src/app/site-url.ts`.

**Sur une prévisualisation, tout ceci répond volontairement autre chose.**
`robots.txt` y refuse tous les robots (`VERCEL_ENV` présent et différent de
`production`), et les canoniques y pointent vers le domaine de production — une
prévisualisation ne doit pas concurrencer la vraie page dans un index. Contrôler les
aperçus se fait donc sur le déploiement de production, ou en acceptant que les
canoniques affichées ne soient pas celles de l'URL testée.

### 3. Protéger `main` et `develop`

**Ces commandes modifient les réglages du dépôt. Elles n'ont pas été exécutées** —
à relire et à lancer sciemment. Elles supposent un `gh auth status` avec le droit
`admin` sur le dépôt, et **un premier run du workflow déjà terminé** : GitHub ne
propose une vérification requise que s'il a vu passer son nom au moins une fois.

Sur `main`, la branche de production. `"strict": true` exige que la branche soit à
jour avec `main` avant la fusion : c'est ce qui empêche deux pull requests vertes
séparément de devenir rouges une fois fusionnées l'une dans l'autre. Sur une
branche qui ne reçoit que des fusions depuis `develop`, le coût est nul.

```bash
gh api --method PUT repos/ThoomassC/travels_in_world/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "checks": [{ "context": "Vérifications" }] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Sur `develop`, la branche d'intégration. Ici `"strict": false` : avec plusieurs
tickets en vol, exiger une remise à jour avant chaque fusion fait rejouer le
pipeline en chaîne pour un bénéfice que le déclenchement du workflow sur les
poussées vers `develop` couvre déjà — la régression apparaît juste après la fusion
plutôt qu'avant, sur une branche qui n'est pas la production.

```bash
gh api --method PUT repos/ThoomassC/travels_in_world/branches/develop/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "checks": [{ "context": "Vérifications" }] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

`enforce_admins` diffère entre les deux, volontairement : sur `develop`, garder la
possibilité de débloquer une situation soi-même ; sur `main`, non — c'est la
production, et « je sais ce que je fais » est exactement le moment où cette garde
sert. `required_pull_request_reviews: null` parce qu'on est seul à relire : exiger
une approbation d'un tiers rendrait toute fusion impossible.

Par l'interface, si l'on préfère : **Settings → Branches → Add branch protection
rule**, motif `main`, cocher « Require status checks to pass before merging »,
chercher `Vérifications`, cocher « Require branches to be up to date before
merging », puis « Do not allow bypassing the above settings ».

Vérifier ensuite que la garde mord réellement, une fois : ouvrir une pull request
avec une faute de lint volontaire et constater que le bouton de fusion est barré.
C'est la même méthode que celle qui a prouvé `test:build` et `test:lint` — une
garde qu'on n'a pas vue refuser n'est pas une garde.

## Renommer ou retirer un voyage

Deux gestes qui cassent des liens déjà envoyés, et deux procédures de trois lignes.
Le registre est `src/i18n/slug-history.ts` ; il est vide aujourd'hui, et la première
entrée est celle qui compte.

**Renommer.** Le slug d'un voyage publié est définitif. On peut le changer, mais
jamais seul :

1. changer `slug:` dans `content/trips/<dossier>/trip.yaml` (et renommer le dossier,
   par convention) ;
2. ajouter `{ from: "<ancien>", to: "<nouveau>" }` à `renamed` dans
   `src/i18n/slug-history.ts` — **cette entrée ne se supprime jamais**, y compris des
   années plus tard : elle est la seule chose qui rattrape un lien envoyé dans une
   conversation que personne ne peut rééditer ;
3. `npm run build` puis `npm run test:e2e`. Le build refuse une entrée incohérente
   (slug malformé, renommage sur lui-même, doublon, chaîne de redirections) en
   nommant le problème.

L'ancienne adresse répond alors **301** vers la nouvelle, servie par la couche de
routage de la plateforme : aucune fonction serveur, et la nouvelle page reste
prérendue.

**Retirer.** Retirer un récit, ce n'est pas seulement supprimer son dossier :

1. ajouter le slug à `withdrawn` dans `src/i18n/slug-history.ts` ;
2. supprimer `content/trips/<dossier>/` ;
3. `npm run build`. L'adresse répond **200** avec une page qui dit que le récit n'est
   plus en ligne et propose la carte et les trois derniers voyages, et la page porte
   `noindex, follow`. Le sitemap ne la liste plus.

Le critère du ticket demandait 410 ; le README explique, mesures à l'appui, pourquoi
un 410 réel coûterait une route non prérendue et pourquoi le `noindex` fait le vrai
travail de déréférencement.

### Le 410 par une règle de plateforme : ce que TIW-31 a cherché

La question laissée ouverte était précise : **une règle dans `vercel.json` peut-elle
rendre un 410 sans qu'aucune route ne devienne `ƒ` ?** Le schéma officiel, celui que
la première ligne du fichier référence déjà, répond **oui**. Un objet de `routes`
porte un `status` entier (100–999) qui ne dépend pas de `dest`, et la documentation en
donne l'exemple nu : `{ "src": "/legacy", "status": 404 }`. Deux points changent par
rapport à TIW-21 : `routes` cohabite désormais avec `headers` et `redirects` — la
documentation l'écrit noir sur blanc, là où les deux s'excluaient — donc adopter la
règle ne demanderait pas de réécrire les en-têtes de sécurité de ce fichier ; et une
règle de `routes` est évaluée par la couche de routage avant toute fonction, donc elle
laisse la colonne de `next build` intacte. Le piège est ailleurs, et il est réel :
`redirects` accepte bien un `statusCode`, mais son `destination` est **obligatoire**
au schéma — un 410 n'est pas une redirection, et un `Location` vide n'en fait pas une.

Ce qui reste **non tranché, et ne peut l'être qu'une fois déployé** : la règle rend-elle
le 410 _avec la page d'explication_, ou avec un corps vide ? Aucun document Vercel ne le
dit. La seule lecture disponible est la réimplémentation du routeur dans `vercel dev`
(`packages/cli/src/util/dev/router.ts`), où un `status` sans `continue` garde le chemin
demandé comme destination, et où `continue: true` enregistre le statut puis poursuit le
routage. Deux comportements plausibles, aucun garanti, et le proxy de production n'est
pas ce code. La règle est prête pour le jour où quelqu'un peut la mesurer sur un
déploiement. La fonction `normalizeRoutes()` du paquet `@vercel/routing-utils`, celui-là
même qui compile ces règles, l'accepte et rend `error: null` — ce qui prouve sa forme,
et rien de son effet :

```json
{ "src": "^/fr/voyages/<slug>/?$", "status": 410, "continue": true }
```

Elle n'est pas posée, pour trois raisons qui s'additionnent. Le registre `withdrawn`
est vide, donc il n'y a aucune adresse sur laquelle l'essayer. **Rien dans ce dépôt
n'exécute `vercel.json`** — ni `next build`, ni `next start`, ni Playwright — donc la
règle serait de la configuration que rien ne garde, exactement ce que les quatre gardes
exécutables du projet existent pour refuser ; et `vercel.json` étant du JSON statique
qui ne peut pas lire `src/i18n/slug-history.ts`, la liste des slugs retirés vivrait à
deux endroits libres de diverger en silence. Enfin, si le pari sur le corps est faux,
le lecteur perd la page et ne garde que trois chiffres : c'est le mauvais côté du
compromis, échangé à l'aveugle.

Côté Next, la porte est fermée et l'était encore le 2026-09-01 sur `canary` : les
statuts qu'un document prérendu sait porter sont un ensemble clos de trois — 404, 403,
401 — et un Route Handler qui rend 410 sort du prérendu à la ligne
`export/routes/app-route.js:95`. Le détail, avec les `fichier:ligne`, est dans
`src/app/[locale]/voyages/[slug]/withdrawn-notice.tsx`.

**Ce qu'il ne faut pas faire, dans les deux cas :** réutiliser un ancien slug pour un
autre voyage. L'entrée du registre redirigerait alors les lecteurs de l'ancien récit
vers le nouveau, silencieusement. Le build ne peut pas l'attraper — il ne sait pas que
les deux voyages sont différents.

## Rollback

**Le rollback ne passe pas par Git.** Un `git revert` reconstruit, ce qui prend des
minutes et peut échouer pour une raison qui n'a rien à voir avec le problème qu'on
essaie de fuir. On repromeut un artefact déjà construit :

**Tableau de bord** — Project → **Deployments** → filtrer sur `Production` →
choisir le dernier déploiement sain → menu `⋯` → **Promote to Production**. Effet
immédiat, aucun build.

**En ligne de commande**, le jour où la CLI Vercel sera installée
(`npm i -g vercel`, puis `vercel login`) :

```bash
vercel rollback                     # revient au déploiement de production précédent
vercel rollback <url-du-deploiement>  # cible un déploiement précis
vercel ls travels-in-world --prod   # lister les déploiements de production pour choisir
```

La CLI n'est pas installée sur le poste aujourd'hui, et le rattachement du projet
se fera par l'interface web : le chemin du tableau de bord est donc le chemin de
référence — c'est celui qui marche sans rien installer, le jour où il faut aller
vite.
