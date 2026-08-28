# travels_in_world

Carnet de voyages personnel : une carte du monde en SVG rendue côté serveur et, pour chaque
voyage, une page en frise chronologique d'étapes. Le contenu vit en fichiers versionnés
(YAML + MDX) — il n'y a pas de base de données. Déploiement sur Vercel.

## Prérequis

- Node **24.x** (`.nvmrc`, champ `engines`) — la version alignée sur le runtime Vercel.
  `nvm use` avant toute commande.
- npm (pas pnpm).

## Démarrer

```bash
npm ci
npm run dev     # http://localhost:3000 → redirige vers /fr
```

**Le serveur de développement n'écoute que sur `127.0.0.1`**, et c'est délibéré : c'est le
seul environnement où les voyages en `draft` sont visibles. Mesuré avant ce réglage — le
socket était en `TCP *:3000 (LISTEN)` et un `curl http://<ip-du-poste>:3000/fr/voyages/<slug>`
depuis une autre machine du réseau rendait un brouillon en 200. Sur le Wi-Fi d'un café ou
d'un hôtel, « en local » ne veut pas dire « pour moi seul ».

Pour tester depuis un téléphone, l'échappatoire est explicite et son coût est écrit :

```bash
npx next dev --hostname 0.0.0.0   # expose brouillons compris à tout le sous-réseau
```

## Scripts

| Script                     | Rôle                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`              | Serveur de développement, sur `127.0.0.1` seulement                       |
| `npm run build`            | Build de production                                                       |
| `npm run start`            | Sert le build de production                                               |
| `npm run lint`             | ESLint (flat config)                                                      |
| `npm run format`           | Prettier en écriture                                                      |
| `npm run typecheck`        | `tsc --noEmit`                                                            |
| `npm run test`             | Vitest, une passe                                                         |
| `npm run test:watch`       | Vitest en veille                                                          |
| `npm run test:build`       | Garde de prérendu + budget de bundle — **exige un `npm run build` avant** |
| `npm run test:e2e`         | Playwright — build + start sur un port dédié, puis `tests/e2e`            |
| `npm run validate:content` | Valide `content/trips/` — tourne aussi en `pretest`                       |
| `npm run new-trip <slug>`  | Crée `content/trips/<slug>/trip.yaml`, squelette commenté                 |
| `npm run geocode <slug>`   | Résout et écrit les coordonnées des villes du voyage                      |
| `npm run index-photos`     | **Non implémenté** — échoue volontairement, voir TIW-17                   |

`index-photos` est le seul des trois à garder son placeholder : il a un nom réservé et sort
en code 1 avec un message explicite, parce qu'un script qui existe et ne fait rien
silencieusement est un piège. `validate:content` le **cite** dans ses messages (« lance
`npm run index-photos japon-2024` ») : c'est délibéré, le message dit dès maintenant où la
réparation se trouvera. Il est attribué à TIW-17, le ticket du pipeline de photos, et n'est pas livré ici.

### La boucle d'écriture d'un voyage

```bash
npm run new-trip japon-2024      # squelette commenté, sans coordonnées
#   … tu remplis les noms de villes et les codes pays …
npm run validate:content         # refuse, et dit « lance npm run geocode japon-2024 »
npm run geocode japon-2024       # liste les homonymes, demande un numéro, écrit
npm run validate:content         # vert
```

**Un `--` dès qu'il y a une option.** npm garde pour lui tout ce qui ressemble à une de ses
propres options : sans le `--`, « --pick 1 » arrive au script comme un second voyage nommé
« 1 » (refusé en code 2, avec un message qui dit d'ajouter le `--`), et la forme
« --pick=1 » ou « --content=/tmp/bac » **disparaît sans un mot** — dans ce dernier cas le
voyage est créé dans le vrai `content/trips`. Les formes correctes sont donc
`npm run geocode -- japon-2024 --pick 1` et `npm run geocode -- --help`. Sans option, le `--`
est inutile, comme dans le bloc ci-dessus. Tableau complet dans `content/README.md`.

C'est la boucle que TIW-10 existe pour créer, et `tests/content/geocode-cli.test.ts` la
verrouille de bout en bout. Trois choses valent d'être connues avant de s'en servir.

**Un homonyme n'est jamais tranché d'office.** « Kyoto » désigne une ville du Japon **et**
un village de Tanzanie ; prendre `results[0]` place le voyage à 8 000 km. Les candidats sont
listés avec leur pays, leur région et leur population, et la commande demande un numéro. Le
pays renvoyé est ensuite comparé au `countryCode` du fichier : en cas de divergence, **rien
n'est écrit** — c'est le garde-fou qui rattrape un mauvais choix humain. (0, 0) est refusé
par `CoordinatesSchema`, le même schéma que les pages.

**Le chemin non interactif** est `--pick <n>`, répétable : le nième `--pick` répond à la
nième ambiguïté — `npm run geocode -- japon-2024 --pick 1 --pick 2`. Sans `--pick` et sans
terminal, les numéros sont lus sur l'entrée standard, un par ligne, **jusqu'à la fin du
flux** : la lecture attend le producteur au lieu de supposer que les octets sont déjà là.
Le mode par défaut reste la question posée au terminal. Un choix déjà écrit ne se rejoue pas
— il faut supprimer le bloc `coordinates:` du lieu concerné, puis relancer.

**La réécriture est chirurgicale.** Commentaires, ordre des clés, style de guillemets,
indentation et lignes vides sont conservés : l'édition est appliquée au texte source aux
offsets que le `Document` de `yaml` fournit, et **pas** par un `setIn()` suivi d'un
`toString()`. Mesuré : `toString()` renormalise une indentation de quatre espaces en deux et
ramène les commentaires de fin de ligne à un espace, ce qui transforme l'ajout de deux
nombres en diff sur tout le fichier. Un fichier déjà complet n'est pas réécrit du tout —
même contenu, même horodatage.

Aucune clé d'API : `geocoding-api.open-meteo.com` n'en demande pas, donc il n'y a aucun
secret à configurer ni à faire fuiter. `TIW_GEOCODING_URL` permet de pointer ailleurs, ce
dont la suite de tests se sert pour ne jamais sortir de la machine.

## Conventions

**Internationalisation.** L'arbre de routes est bilingue dès maintenant (`/fr/...`, plus tard
`/en/...`) avec une seule langue active. Trois règles :

1. Aucune chaîne d'interface en dur, y compris dans un placeholder — tout passe par
   `src/i18n/messages/<locale>.json`.
2. Pour une route interne, on importe `Link`, `redirect`, `usePathname` et `useRouter`
   depuis `@/i18n/navigation`, **jamais** de `next/link` ni de `next/navigation` : ces
   primitives ignorent le segment `[locale]` et produisent un 404 silencieux. Le cas le
   plus vicieux est `usePathname` : celui de Next renvoie le chemin **avec** le préfixe
   `/fr`, celui de next-intl **sans** — même nom, valeur opposée, aucun avertissement.
   ESLint (`no-restricted-imports`, en `patterns` pour attraper aussi `next/link.js`) le
   refuse partout sauf dans `src/i18n/navigation.ts`. Angle mort connu et assumé :
   `await import("next/link")` est un appel, pas une déclaration d'import — la règle ne
   peut pas le voir.
3. `src/app/layout.tsx` ne rend que `{children}`. `<html lang>` et `<body>` sont émis par
   `src/app/[locale]/layout.tsx`, qui connaît la locale, et par `src/app/not-found.tsx`.

**Rendu statique.** Toutes les routes doivent rester prérendues (`○`/`●` dans la sortie de
`npm run build`, jamais `ƒ`). En dehors du segment `[locale]` il n'y a pas de locale de
requête : une lecture implicite (`getTranslations("ns")` sans locale, ou le composant `Link`
côté serveur) fait lire les en-têtes à next-intl et **bascule tout l'arbre en dynamique**.
Voir le commentaire de `src/app/not-found.tsx`. Vérifier la colonne de `npm run build` après
toute modification du 404 ou du layout racine.

Cette casse est **silencieuse** : le build sort en code 0, affiche `✓ Generating static
pages (3/3)`, et le HTML servi est identique — seul `.next/server/app/fr.html` disparaît.
`npm run test:build` est la seule vérification automatique de cet invariant : elle lit
`.next/prerender-manifest.json` et exige `/fr` et `/_not-found`. Elle exige un build avant
elle et ne le fait pas à votre place (branchée en CI par TIW-22). Le même fichier porte le
budget de charge utile de `/fr` : 1,5 Ko brotli de HTML pour un plafond de 100 Ko, 120 Ko
brotli de JS initial pour un plafond de 150 Ko — chunk `noModule` exclu, c'est le bundle de
compatibilité que jamais aucun navigateur moderne n'exécute et il vaut 35 Ko à lui seul.

**Pas de proxy ni de middleware.** La redirection `/` → `/fr` est une entrée de
`redirects()` dans `next.config.ts`. Un proxy s'exécuterait en runtime Node sur **chaque**
requête HTML, `/fr` compris, alors que `/fr` est du HTML préconstruit que le CDN sait servir
seul ; une redirection de configuration est traitée par la couche de routage de la
plateforme, et la ligne `ƒ Proxy (Middleware)` disparaît de la sortie de build. Trois
conséquences assumées :

- pas de négociation `Accept-Language` et pas de cookie `NEXT_LOCALE` (voir
  `localeCookie: false` dans `src/i18n/routing.ts` : une réponse porteuse de `Set-Cookie`
  n'est pas mise en cache par un CDN, et le cookie primerait sur l'URL sans aucune UI pour
  revenir) ;
- un chemin profond **sans** préfixe de locale (`/voyages/japon-2024`) répond **404** au
  lieu d'être redirigé vers `/fr/voyages/japon-2024`. Tous les liens internes portent leur
  préfixe, donc seules les URL tapées à la main ou tronquées par un tiers tombent là.
  La page 404 (TIW-21) doit donc rester une vraie porte de sortie : titre, explication et
  lien vers l'accueil au minimum ;
- un préfixe inconnu (`/de`) répond 404 sur place, sans réécriture vers `/fr/de`.

**Limitation connue du 404.** Il n'existe qu'un seul `src/app/not-found.tsx`, qui fige
`routing.defaultLocale`. Le jour où `en` sera actif, `/en/page-inexistante` servira donc un
404 **en français**, annoncé `lang="fr"`. Ajouter `src/app/[locale]/not-found.tsx` ne le
corrige pas : mesuré, une URL sans route correspondante part au 404 global et n'atteint
jamais la limite du segment. Le contournement par catch-all `[locale]/[...rest]` corrige la
langue mais introduit une route dynamique `ƒ` et rend `<html id="__next_error__">` — refusé.
L'alarme est le test unitaire « declares exactly one active locale » : il passe au rouge dès
qu'une seconde locale est déclarée, et son commentaire liste ce qu'il faut traiter d'abord.

**Validation du contenu.** Les voyages sont des `content/trips/<slug>/trip.yaml` écrits à
la main ; `content/README.md` en donne la structure. `npm run validate:content` les valide
avec le **même `TripSchema`** que les pages (une règle métier a un seul endroit où vivre) et
y ajoute les trois contrôles que le schéma ne peut pas faire : l'unicité d'un slug dans
**toute** la collection, l'existence réelle des photos sur le disque, et la traduction des
erreurs en messages actionnables. Le message est le livrable : chaque ligne porte le chemin
du fichier relatif à la racine, la ligne et la colonne, le champ en écriture lisible
(`steps[2].fromSlug`) et **la commande exacte** à lancer quand il en existe une. Aucune
couleur ANSI quand la sortie n'est pas un terminal. La commande est branchée en `pretest`,
donc un contenu fautif ne peut pas traverser la suite : elle sort en code 1, jamais en
silence.

Deux dossiers de contenu sont paramétrables (`--content`, `--public`, ou `TIW_CONTENT_DIR`
et `TIW_PUBLIC_DIR`), ce qui est ce qui permet de tester la validation contre les fixtures
de `tests/fixtures/content/` sans toucher aux vrais voyages. `new-trip` et `geocode`
acceptent les mêmes `--content` / `TIW_CONTENT_DIR`, et les trois commandes partagent leur
analyse d'arguments (`scripts/arguments.ts`) : les quatre refus qui comptent — `--content=`
vide, option donnée deux fois, valeur qui ressemble à une option, argument vide passé par
npm — sont écrits une fois et valent pour les trois. S'y ajoute le diagnostic du `--` oublié :
un positionnel surnuméraire qui a la forme de la valeur d'une option jamais reçue est la
signature de l'option qu'npm a mangée, et le refus le dit en donnant la ligne à retaper.

**Scripts en TypeScript.** `scripts/**` est du TypeScript exécuté par Node 24, qui strippe
les types nativement. Son résolveur, en revanche, ne lit pas `tsconfig.json` : ni `@/domain/schema`
ni le `./geo` sans extension de `src/domain/schema.ts` ne se résolvent seuls, et le domaine
n'est pas réécrivable pour arranger un script. D'où
`scripts/runtime/typescript-resolve.mts`, un hook `resolve` de 40 lignes chargé par
`node --import`, qui n'ajoute que ces deux formes et repasse tout le reste à Node. Les
scripts de contenu de TIW-10 le réutiliseront.

**Styles.** CSS nu avec custom properties, aucun Tailwind, aucun CSS-in-JS. Un seul fichier
global, `src/styles/tokens.css`, qui porte les jetons ; le style par composant se fait en CSS
Modules à côté du composant. La palette est volontairement identique à celle du portfolio :
toute modification de couleur doit y être répercutée.

**La carte du monde.** Un `<svg>` **entièrement inerte** — `aria-hidden`, sans `tabindex`,
sans `:hover`, `pointer-events: none` — surmonté d'un calque HTML de `<a>` positionnés en
pourcentages. Zéro octet de JavaScript : le zoom et le panneau de survol sont TIW-14, qui
possède l'unique `'use client'` réservé à la carte.

Trois choses à savoir avant d'y toucher, chacune détaillée dans
`docs/adr/0003-carte-svg-inerte-et-balises-html.md` :

1. **Les balises sont du HTML, pas des formes SVG**, et c'est ce qui rend la cible de 44 px
   indépendante du zoom : un `<circle r="6">` se dilate avec le `viewBox`, un `<a>` en `rem`
   non. Conséquence heureuse : le SVG étant sans élément interactif, « les pays non
   actionnables ne sont ni focusables ni survolables » est vrai par construction, pas par une
   liste de règles CSS qu'on peut défaire une par une.
2. **Le cadrage écrase le `viewBox`, il ne reprojette pas.** `src/map/**` produit les chemins
   dans une boîte fixe de 960 × 500 ; `src/components/map/frame.ts` en découpe une fenêtre.
   Recadrer est un zoom exact et préserve la calibration de l'arrondi des chemins à une
   décimale ; reprojeter la détruirait pour le même résultat visuel. La règle de cadrage a
   sept étapes nommées et deux cas dégénérés qui décident de tout — zéro voyage (le rendu de
   production actuel, `content/trips` étant vide jusqu'à TIW-24) et un seul voyage, dont
   l'emprise est un point.
3. **Le rapport d'aspect du conteneur doit être celui du `viewBox`, exactement**, sinon
   `preserveAspectRatio` ajoute des bandes et chaque balise dérive du pays qu'elle nomme.
   C'est le seul usage de `style` inline de cette couche, et il est irréductible : faire
   passer un nombre calculé au build jusqu'à une déclaration CSS n'a pas d'autre voie sans
   JavaScript. Corollaire pour le jour où une CSP arrivera — sans `style-src 'unsafe-inline'`
   ni nonce, toutes les balises se superposent en haut à gauche **sans erreur bloquante**.

Les couleurs viennent toutes de `tokens.css`, mais pas de n'importe lesquelles : le trait de
côte et la bordure de la carte sont en `--control-border` (le jeton documenté `>= 3:1`) parce
que `--border-subtle` mesurait 1,37:1 et que la forme du monde est l'objet graphique
nécessaire à la compréhension ; la distinction visité / non visité est portée par un contour
en `--text-accent` **et par son épaisseur**, parce qu'aucune valeur de remplissage ne dépasse
3:1 en thème clair et qu'un canal non coloré est nécessaire.

**Dépendances écartées** (délibérément, ne pas les rajouter sans ticket) : bibliothèque de
carte côté client (Leaflet, MapLibre), gestionnaire d'état (Redux, Zustand), client HTTP ou
React Query, bibliothèque de formulaires, Tailwind, bibliothèque d'icônes React
(`@tabler/icons-react` a été retirée : les icônes sont du SVG rendu au build, pas des
composants client). Avec des Server Components et un contenu
versionné, il n'y a ni état client à partager ni données à aller chercher.

**`AGENTS.md` / `CLAUDE.md`.** Générés et réécrits par `next dev` (Next 16). Ils sont
committés volontairement : les supprimer ne fait que salir l'arbre au prochain `next dev`.
Pour s'en passer, `agentRules: false` dans `next.config.ts`.

## Tests

- Vitest + Testing Library pour l'unitaire et le composant (`tests/`, `src/**/*.test.tsx`).
  `globals: true` est volontairement absent de `vitest.config.ts` : sans `vitest/globals`
  dans les `types` du `tsconfig`, un test écrit avec les globals passe au vert sous Vitest et
  casse `npm run typecheck` **et** `next build` (`TS2582`). On importe depuis `"vitest"`.
- `tests/content/` couvre la validation de contenu à trois niveaux : le formatage du
  rapport en fonction pure, le diagnostic contre les fixtures de `tests/fixtures/content/`
  (un dossier par défaut porté), et la commande elle-même lancée en sous-processus — code de
  sortie **et** texte du message. Le contenu volontairement fautif vit dans les fixtures,
  jamais dans `content/`.
- **Les commandes sont aussi testées à travers `npm run`, pas seulement à travers Node.**
  Un cas coûte ~2 s au lieu de ~0,3 s, donc il y en a peu : ceux qui ne peuvent se voir que
  par ce chemin. C'est npm qui mange les options quand le `--` manque, et une suite qui
  n'appelle que `node scripts/geocode.ts` ne peut pas le savoir — elle a laissé passer neuf
  lignes de documentation inexécutables. `tests/content/cli.test.ts` complète la garde en
  relisant les deux README et les trois `--help` : toute ligne de commande copiable qui porte
  une option doit porter le `--`.
- **Aucun test ne sort de la machine.** Le géocodage est testé à deux niveaux, tous les deux
  hors réseau : le client HTTP reçoit son `fetch` en paramètre (statut 429, 500, corps non
  JSON, hôte injoignable, délai dépassé, réponse valide mais vide), et
  `tests/content/geocode-cli.test.ts` lance un serveur `node:http` sur 127.0.0.1 qui sert la
  charge utile capturée d'un vrai appel — ce qui exerce toute la chaîne (`fetch`, code de
  statut, `JSON.parse`, schéma Zod) sans jamais solliciter un service public gratuit. Ce
  fichier utilise `spawn` et non `spawnSync` : le second bloque le fil d'exécution, et le
  serveur local ne pourrait jamais accepter la connexion du sous-processus.
- `tests/build/` (script `test:build`, config `vitest.build.config.ts`) assère sur les
  artefacts de `.next/` : prérendu et budget de bundle. Hors de `npm run test`, qui doit
  rester rapide et sans build.
- Playwright pour l'E2E (`tests/e2e/`), lancé contre un **build de production** sur un port
  dédié (`E2E_PORT`, 3277 par défaut) avec `reuseExistingServer: false`. Les deux comptent :
  sur le port 3000 et avec la réutilisation, la suite s'accrochait au `next dev` du poste et
  passait au vert contre du HTML de développement, sans aucun build.
- `tests/setup.ts` neutralise le `localStorage` natif de Node 25, qui masque celui de jsdom.
  Ne pas le supprimer sans lire le commentaire. `tests/storage.test.ts` verrouille le
  contrat du stub (accès par propriété nommée, énumération, conversion des clés, absence de
  fuite entre tests) : un stub qui s'écarte du navigateur fait passer au vert du code qui
  casse en production.

## Intégration continue

`.github/workflows/ci.yml` rejoue toute la chaîne sur chaque pull request, et sur chaque
poussée vers `main` et `develop` : `lint`, `typecheck`, `validate:content`, `test`,
`test:lint`, `build`, `test:build`, `test:e2e`. Trois jobs en parallèle — les vérifications
sans build, le build avec ses deux gardes d'artefact, Playwright — plus un quatrième,
`Vérifications`, qui n'exécute rien et refuse si l'un des trois a échoué. C'est ce quatrième
nom, et lui seul, que la protection de branche connaît : sinon un job ajouté demain serait
consultatif — rouge, visible, et la fusion passerait quand même — jusqu'à ce que quelqu'un
pense à cocher une case dans une interface.

`test:build` vit dans le job du build, pas ailleurs : il lit
`.next/prerender-manifest.json` et pèse les chunks de `.next/static`, donc il lui faut
l'artefact réel sur le même disque. Il n'est ni `continue-on-error`, ni conditionnel, ni
sautable — c'est la seule vérification automatique du prérendu et des budgets. L'E2E est un
job séparé parce que `playwright.config.ts` reconstruit tout (`reuseExistingServer: false`,
délibéré) : on paie donc deux builds, mais en parallèle, donc en zéro seconde de latence de
retour. Ce qui est mutualisé d'un run à l'autre, c'est le téléchargement de Chromium, mis en
cache sur la version de Playwright installée.

La version de Node est lue depuis `.nvmrc` (`node-version-file`), jamais écrite en dur : une
version figée dans le workflow est une seconde source de vérité qui s'écarte silencieusement
de `engines` et du runtime Vercel. Les actions tierces sont épinglées au SHA, avec le tag en
commentaire, et le jeton du workflow est en lecture seule (`permissions: contents: read`).

**Ce que la CI ne garde pas : le déploiement.** Vercel se déclenche sur l'événement Git et
n'attend pas le pipeline — une prévisualisation est en ligne pendant qu'il tourne, et le
reste s'il finit rouge. C'est voulu : c'est là que se relit un voyage en `draft`. Ce qui
protège la production, c'est que la production ne part que de `main`, qu'on n'y arrive que
par une fusion, et qu'une fusion est refusée quand le pipeline est rouge.

## Déploiement

Vercel. Les en-têtes de sécurité et le cache long des assets sont dans `vercel.json`, qui
porte aussi `buildCommand: "npm run validate:content && npm run build"` : le build de
déploiement refuse un contenu que les pages ne sauraient pas charger, y compris s'il est
arrivé sur `main` sans passer par une pull request. Le reste de la suite n'y est pas — un
build de déploiement doit construire, et le budget de bundle comme le prérendu sont des
propriétés du code que la pull request a déjà mesurées.

`output: "export"` est exclu : il désactiverait l'optimisation des images et interdirait la
route API prévue. Aucun secret n'est committé — injection au runtime uniquement, et le projet
n'en a aujourd'hui aucun : `geocoding-api.open-meteo.com` ne demande pas de clé.

**Deux réglages vivent hors du dépôt** et ne sont donc pas garantis par lui : le rattachement
du projet Vercel (branche de production `main` — et non `develop`, la branche par défaut du
dépôt, que Vercel prendrait sans qu'on lui dise ; runtime Node 24.x, et non le défaut de la
plateforme) et la protection de branche GitHub. La check-list ordonnée de ce qu'il faut
cliquer, les commandes `gh` exactes et la procédure de rollback sont dans
[`docs/deploiement.md`](docs/deploiement.md) ; la décision qui explique ce découpage est
l'ADR [`0004`](docs/adr/0004-la-ci-garde-la-fusion-pas-le-deploiement.md).
