# travels_in_world

Carnet de voyages personnel : une carte du monde en SVG rendue côté serveur et, pour chaque
voyage, une page en frise chronologique d'étapes. Le contenu vit en fichiers versionnés
(YAML aujourd'hui ; le texte des étapes n'existe pas encore dans le schéma, voir la note
de TIW-16) — il n'y a pas de base de données. Déploiement sur Vercel.

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
| `npm run build`            | Build de production — `prebuild` y lance `validate:content` d'abord       |
| `npm run start`            | Sert le build de production                                               |
| `npm run lint`             | ESLint (flat config)                                                      |
| `npm run format`           | Prettier en écriture                                                      |
| `npm run typecheck`        | `tsc --noEmit`                                                            |
| `npm run test`             | Vitest, une passe                                                         |
| `npm run test:watch`       | Vitest en veille                                                          |
| `npm run test:build`       | Garde de prérendu + budget de bundle — **exige un `npm run build` avant** |
| `npm run test:e2e`         | Playwright — build + start sur un port dédié, puis `tests/e2e`            |
| `npm run validate:content` | Valide `content/trips/` — tourne aussi en `pretest` et en `prebuild`      |
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
`/en/...`) avec une seule langue active. Quatre règles :

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
3. **Pour un simple `href` dans un composant serveur, c'est `localePathname` de
   `@/i18n/pathname` — pas `getPathname` de `@/i18n/navigation`.** Les cinq exports de
   `@/i18n/navigation` sortent d'un seul `createNavigation(routing)`, dans un module qui
   importe le `BaseLink` `"use client"` au niveau supérieur : importer n'importe lequel
   enregistre une référence client pour la route et y expédie le `Link` **client** de
   next-intl. Mesuré sur `/fr`, même `href` rendu à l'octet : 119,9 Ko et 6 chunks contre
   123,7 Ko et 8 chunks. Un module dédié n'y change rien, et next-intl 4.14.1 non plus —
   les deux ont été vérifiés. `@/i18n/navigation` reste la bonne porte quand on veut le
   runtime client (`Link`, `redirect`, `usePathname`, `useRouter`) ; l'assemblage d'URL
   reste dans `src/i18n/**` dans les deux cas, ce qui est ce qu'exige la règle 2. Détail
   et gardes : `docs/adr/0005-getpathname-sans-le-link-client.md`.
4. `src/app/layout.tsx` ne rend que `{children}`. `<html lang>` et `<body>` sont émis par
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
budget de charge utile, désormais appliqué aux **deux** routes prérendues et non à `/fr`
seule : 37,3 Ko brotli de HTML sur `/fr` — les tracés du planisphère, en ligne dans le
document — et 1,3 Ko sur `/_not-found`, pour un plafond de 100 Ko ; et pour un plafond de 150 Ko de JS
initial, 123,2 Ko sur `/fr` (7 chunks) et 111,2 Ko sur `/_not-found` (5 chunks) — chunk
`noModule` exclu, c'est le bundle de compatibilité que jamais aucun navigateur moderne
n'exécute et il vaut 34 Ko à lui seul. Chiffres relevés sur `develop` @ `5c5bf34`, après
que TIW-14 a posé le premier des deux composants `'use client'` du jalon : son chunk de
carte interactive vaut 3,2 Ko des 123,2.

Ne mesurer que `/fr` a coûté exactement ce que ce genre d'angle mort coûte : le `Link`
client de next-intl dormait dans le bundle initial de `/_not-found`, la seule route que rien
ne regardait, pendant que `/fr` était déclaré propre (TIW-28). Le même fichier porte donc
aussi un garde qui refuse ce `Link` dans tout chunk initial de toute route prérendue, par
empreinte et non par plafond : à 123,7 Ko la régression passait les 150 Ko sans encombre, et
un plafond assez serré pour l'attraper aurait refusé les 3 Ko de travail légitime suivants.

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

**Adresses durables et aperçus de partage.** Le slug d'un voyage publié est **définitif**.
Le renommer est autorisé et coûte une entrée dans `src/i18n/slug-history.ts`, pour toujours :
`next.config.ts` en dérive une redirection **301** (`statusCode: 301`, et non
`permanent: true` qui émet un 308 que plusieurs dérouleurs de liens refusent de suivre).
Le registre porte aussi les voyages **retirés volontairement**, dont l'adresse reste une
page qui explique que le récit n'est plus en ligne et propose la carte et les trois
derniers voyages. Le vrai cas n'est pas la suppression, c'est le renommage silencieux :
transformer `japon-2024` en `japon-printemps-2024` casse tous les liens déjà envoyés, dans
des conversations que personne ne peut rééditer, et rien ne le signale. Le registre refuse
au build une entrée qui ne peut pas vouloir dire ce qu'elle dit — slug malformé,
renommage sur lui-même, même ancienne adresse deux fois, slug à la fois renommé et retiré,
chaîne de redirections.

**Le 410 n'est pas rendu, et c'est mesuré.** Une page retirée répond **200** avec
`noindex, follow` là où le critère demande 410. Next 16.3.1 sait porter 404, 401 et 403 sur
un document prérendu (`notFound()`, `unauthorized()`, `forbidden()`) et n'expose rien pour
410 ; un Route Handler y arrive, et cesse d'être prérendu dès qu'il le fait — le même
handler rend `○` en 200 et `ƒ` en 410, alors que le fichier `.meta` écrit à côté d'un corps
prérendu porte bien un champ `status`. Un vrai 410 coûte donc une fonction serveur sur une
URL qui n'a rien à calculer, contre l'invariant 1. Le détail complet est dans
`src/app/[locale]/voyages/[slug]/withdrawn-notice.tsx`.

**L'origine du site vit dans un seul fichier**, `src/app/site-url.ts` : `TIW_SITE_URL` s'il
est posé, sinon `VERCEL_PROJECT_PRODUCTION_URL` que Vercel fournit à chaque build, sinon la
constante `FALLBACK_SITE_URL`. Le jour où un vrai domaine est ajouté, il n'y a **rien** à
modifier dans le dépôt : Vercel sert le nouveau domaine par la deuxième entrée. `VERCEL_URL`
est délibérément ignorée — c'est l'URL du _déploiement_, avec un suffixe différent à chaque
poussée, donc une canonique qui nomme une adresse que personne ne relira jamais. Une valeur
présente mais inutilisable fait **échouer le build** au lieu de retomber sur le défaut : une
canonique fausse partout avec un build vert est exactement la casse silencieuse que ce dépôt
refuse.

**Image de partage : la photo de couverture, pas une image générée** — décision mesurée, pas
par facilité. Un `opengraph-image.tsx` sous `[slug]` a été construit et pesé : sans
`generateStaticParams` il rend `ƒ` ; **avec**, la colonne de build affiche `●` et se trompe —
aucun PNG n'est écrit sous `.next/server/app`, aucune paire `.body`/`.meta`, et
`prerender-manifest.json` ne liste aucune des images concrètes sous `routes`, donc
`npm run test:build` (qui dérive sa liste de `routes`) ne les pèse pas non plus. Surtout :
l'image étant rendue à la demande, elle sort de la frontière de publication que
`dynamicParams = false` ferme sur la page. Mesuré contre `next start` avec un voyage
`draft: true` : `/fr/voyages/<brouillon>` répond **404** et
`/fr/voyages/<brouillon>/opengraph-image` répond **200** avec un PNG de 20,6 Ko portant son
titre. Ajouter `dynamicParams = false` sur la route d'image ne corrige rien : elle répond
alors **404 pour tous les slugs**, publiés compris. Un voyage sans photo obtient donc une
carte avec titre et description sans image, et `twitter:card` retombe sur `summary`.

**`sitemap.xml` et `robots.txt` sont des Route Handlers prérendus** (`○` dans la colonne de
build, un `.body` sur le disque). Le sitemap ne liste que les voyages **publiés**, et ce
n'est pas un filtre écrit là : il appelle `listTripSummaries()`, la même porte que la page
d'accueil et la liste, donc il n'existe pas de seconde règle de publication qui puisse
diverger de la première. `robots.txt` ne `Disallow` rien — pas même les adresses retirées : un
robot interdit de récupérer une page ne peut jamais y lire le `noindex`, donc l'entrée
_conserverait_ le référencement qu'elle prétend retirer. Sur un déploiement de
prévisualisation (`VERCEL_ENV` présent et différent de `production`), il refuse en revanche
tout le monde.

**Validation du contenu.** Les voyages sont des `content/trips/<slug>/trip.yaml` écrits à
la main ; `content/README.md` en donne la structure. `npm run validate:content` les valide
avec le **même `TripSchema`** que les pages (une règle métier a un seul endroit où vivre) et
y ajoute les contrôles que le schéma ne peut pas faire : l'unicité d'un slug dans **toute**
la collection, l'existence réelle des photos sur le disque, l'existence réelle du pays
qu'un `countryCode` désigne, et la traduction des erreurs en messages actionnables. Le message est le livrable : chaque ligne porte le chemin
du fichier relatif à la racine, la ligne et la colonne, le champ en écriture lisible
(`steps[2].fromSlug`) et **la commande exacte** à lancer quand il en existe une. Aucune
couleur ANSI quand la sortie n'est pas un terminal. La commande est branchée en `pretest`
**et en `prebuild`**, donc un contenu fautif ne traverse ni la suite ni un build : elle sort
en code 1, jamais en silence.

`prebuild` est arrivé avec TIW-29, et il ferme un chemin que `vercel.json` ne couvrait pas.
`CountryCodeSchema` valide la _forme_ d'un code pays et refuse de connaître la liste des
pays (`docs/adr/0001-domain-purity.md`) ; `buildWorldGeometry` lève sur tout code hors des
249 de l'ISO 3166-1. Un voyage déclarant `XK` — le code d'usage du Kosovo — passait donc la
validation (« 1 voyage validé, aucun problème ») et faisait échouer `npm run build` au
prérendu de `/fr`, avec un message qui renvoyait à `validate:content` : l'auteur tournait en
rond. La vérification vit maintenant dans le validateur, et le hook npm garantit qu'aucun
`npm run build` ne s'exécute sans elle — la CI lançant le build et la validation dans deux
jobs séparés, `vercel.json` seul ne suffisait pas.

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

**La marque est provisoire, et remplaçable sans toucher au code.** Le logotype est une
comète en `--logo-ink` — une seule masse connexe — accompagnée d'une trajectoire en
pointillé en `--logo-accent`, et du nom composé dans la pile de polices du site. C'est une
marque **typographique**, assumée comme telle : il n'y a ni police propre, ni dessin de
lettres. Cinq fichiers, et une seule source de vérité :

| Fichier                                     | Ce qu'il porte                                       |
| ------------------------------------------- | ---------------------------------------------------- |
| `src/components/site/brand-art.ts`          | **la géométrie** — chemins, boîtes, transformations  |
| `src/app/icon.svg`                          | le favicon, thème embarqué (copie du chemin, gardée) |
| `src/app/apple-icon.png`                    | 180 × 180, opaque, sur la plaque `--logo-bg`         |
| `public/opengraph-default.png`              | 1200 × 630, l'image de partage par défaut du site    |
| `src/components/site/site-brand.module.css` | les tailles et les états du verrouillage d'en-tête   |

Pour substituer un dessin définitif : remplacer les chaînes de `brand-art.ts`, recopier le
même `d` dans `icon.svg`, régénérer les deux PNG. Aucun composant, aucun test et aucune
feuille de style n'a besoin d'être modifié. **Ce qui casse si les proportions changent** : le
`viewBox` du verrouillage décide de la largeur de la marque pour une hauteur de `2rem` (la
boîte est plus large que haute, c'est ce qui l'empêche de dominer le nom) ; la plaque de
l'icône Apple porte la seule couleur en dur du lot, parce qu'un PNG ne suit aucun thème ; et
l'image de partage **doit** rester en 1200 × 630, sans quoi `og:image:width` /
`og:image:height` mentent et la carte se réagence après le chargement.
`tests/build/brand.test.ts` refuse ce dernier cas en lisant l'en-tête du PNG.

Deux contraintes de dessin sont mesurées et ne se contournent pas. **Encre contre accent ne
vaut que 1,99:1 en clair et 1,35:1 en sombre** : aucune forme ne peut donc reposer sur cette
frontière, et c'est pourquoi la comète et la trajectoire sont deux objets séparés par du fond
nu — chacun se lit contre la page (encre 10,54:1 clair et 16,73:1 sombre, accent 5,30:1 et
12,40:1) et jamais contre l'autre. **Le favicon abandonne la trajectoire** : à 16 px ses
points et leurs vides passent sous le pixel, alors que la masse de la comète tient (10,31:1
au pire sur les huit gris de barres d'onglets de Chrome, Firefox et Safari, tous thèmes
confondus).

Enfin, `src/app/icon.svg` est un document **XML**, pas du HTML, et il a cassé trois fois
avant d'être juste — chaque fois en silence, parce qu'un SVG en ligne dans une page se répare
tout seul alors que le même fichier chargé comme favicon meurt sans un mot. Ses règles :
jamais deux tirets consécutifs dans un commentaire XML, la feuille de style dans une section
`CDATA` (sinon le moindre `<` d'un commentaire CSS termine le fichier), et jamais la séquence
qui referme cette section ailleurs qu'à la fin. `tests/components/site/brand-art.test.ts`
compte les délimiteurs dans les octets, parce que le `DOMParser` de jsdom a accepté un
fichier que `xmllint` et Chromium refusaient.

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

**L'équivalent textuel de la carte est un composant à part, pas un bloc masqué**
(`src/components/map/visited-countries.tsx`, TIW-15) : sous la carte, les pays
atteints par les voyages publiés avec le nombre de voyages de chacun, chaque pays
étant un lien. Quatre choses à savoir avant d'y toucher :

1. **Il lit les voyages, jamais la géométrie.** C'est ce qui rend le critère « carte
   en échec » atteignable : `buildWorldGeometry` **jette** pour un code déclaré
   qu'il ne sait pas dessiner, donc un état sans forme de pays est un état sans code
   déclaré — et une liste alimentée par le sous-ensemble teinté aurait été vide
   exactement dans les états où le dessin manque. Une panne, deux canaux perdus.
2. **Il relie, il ne duplique pas.** `/voyages` est déjà l'inventaire complet de
   « quels voyages, où ». Ce qui manquait était le **compte par pays**, qui
   n'existait dans aucun canal. Le lien d'une ligne va vers ce qui existe à coup
   sûr : **le voyage lui-même** quand le pays n'en porte qu'un, la liste complète
   sinon. Jamais un fragment. La première version pointait
   `/voyages#pays-<code>` et **ça pendait dans le vide** — `buildCatalogue` classe
   un voyage sous son **pays de première arrivée** seulement, donc un pays
   seulement _traversé_ n'a aucune section, et `#pays-bo` ne correspondait à rien
   (mesuré sur un build de production). Un fragment sans cible n'échoue pas : il
   dépose le lecteur en haut d'une longue page.
3. **La légende ne promet plus le monde quand le cadre est recadré.** `frameAround`
   plancher un cadre à 30 % de la largeur du monde, donc avec **un** voyage publié
   la carte montrait un continent sous « Carte du monde : 1 voyage, 1 pays ». Deux
   clés (`map.summary`, `map.summaryCropped`) et un test qui assère le libellé
   **contre le `viewBox` rendu**. Le recadrage porte sur les **balises** — une par
   voyage, sur la première arrivée — et non sur les pays teintés, d'où
   « recadrée sur les voyages publiés » et pas « sur les pays visités ».
4. **Aucun cadre vide.** Sans géométrie, le `<svg>` était une boîte au rapport
   verrouillé contenant du vide, sans une erreur ni une ligne de console.
   `WorldMap` ne rend alors pas la boîte du tout : une phrase prend sa place.

L'énumération masquée des pays visités qui vivait dans le `<figcaption>` a été
**retirée** : un `<figcaption>` est le **nom accessible** du `<figure>` (HTML-AAM),
et quarante noms de pays dans un nom accessible n'est pas un libellé. La liste
visible la remplace sur tous les plans. `docs/adr/0003-carte-svg-inerte-et-balises-html.md`
en décrit encore l'ancienne version : à reprendre avec TIW-27.

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
- **`npm run test:e2e` lance Playwright deux fois, séquentiellement, et fait donc deux
  builds.** `playwright.content.config.ts` d'abord (port 3278, le contenu de
  `tests/fixtures/content/home-map` via `TIW_CONTENT_DIR`, les specs `*.populated.spec.ts`),
  puis `playwright.config.ts` (port 3277, le `content/trips` du dépôt, tout le reste). Les
  deux états sont réels et aucun ne couvre l'autre : le dépôt est vide jusqu'à TIW-24, donc
  l'accueil n'y a aucune balise, aucun pays et aucun compte à vérifier — or l'équivalent
  textuel de la carte (TIW-15) existe précisément pour donner le nombre de voyages par pays.
  Les specs peuplées comptent ; celles du dépôt vérifient le bloc de repli. Deux serveurs
  dans une seule config a été essayé puis écarté : deux `next build` concurrents dans un même
  `.next` s'écrasent, et donner un `distDir` au second ajoute à la racine un répertoire de
  build que `eslint .` parcourt — ESLint ne lit pas `.gitignore`. **L'ordre compte** : la
  config peuplée passe en premier, donc le `.next` qui reste sur le disque est celui du
  contenu réel, ce que `npm run test:build` attend. **Corollaire à connaître** :
  `npm run test:e2e:content` lancé **seul** laisse un `.next` bâti sur les fixtures, et
  `npm run test:build` mesurerait alors le budget de pages de fixtures en restant vert —
  il dérive ses routes du manifeste, pas d'une liste attendue. Relancer `npm run build`
  avant `npm run test:build` dans ce cas.
- **L'audit d'accessibilité est automatisé** (`tests/e2e/support/axe.ts`) : axe-core est
  injecté dans la page servie et interrogé sur les tags WCAG 2.2 AA, dans les deux thèmes —
  chaque couleur venant d'un jeton redéclaré sous `prefers-color-scheme: dark`, une faute de
  contraste peut n'exister que dans l'un des deux. `axe-core` est une `devDependency`
  explicite, promue depuis la dépendance transitive de `eslint-plugin-jsx-a11y` : aucun
  téléchargement, deux lignes de `package-lock.json`, zéro octet côté client. Une seule
  violation est tolérée, nommée et confinée — `target-size` sur les **balises** de la carte,
  qui se recouvrent dès que deux voyages sont proches à l'échelle du rendu. Elle est
  préexistante (mesurée à l'identique sur la branche de base), documentée dans
  `docs/adr/0003-carte-svg-inerte-et-balises-html.md` et attribuée à TIW-14 ; l'exception ne
  couvre que cette règle, et seulement tant que tous ses nœuds sont dans le `<figure>`.
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
porte aussi `buildCommand: "npm run validate:content && npm run build && npm run test:build"` :
le build de déploiement refuse un contenu que les pages ne sauraient pas charger, y compris
s'il est arrivé sur `main` sans passer par une pull request. Depuis TIW-29 le hook `prebuild`
de `package.json` le refuserait de toute façon ; les deux sont gardés, l'un couvrant le
déploiement et l'autre tout autre appel de `npm run build`. Le reste de la suite n'y est pas — un
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
