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

| Script                        | Rôle                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                 | Serveur de développement, sur `127.0.0.1` seulement                       |
| `npm run build`               | Build de production — `prebuild` y lance `validate:content` d'abord       |
| `npm run start`               | Sert le build de production                                               |
| `npm run lint`                | ESLint (flat config)                                                      |
| `npm run format`              | Prettier en écriture                                                      |
| `npm run typecheck`           | `tsc --noEmit`                                                            |
| `npm run test`                | Vitest, une passe                                                         |
| `npm run test:watch`          | Vitest en veille                                                          |
| `npm run test:build`          | Garde de prérendu + budget de bundle — **exige un `npm run build` avant** |
| `npm run test:e2e`            | Playwright — build + start sur un port dédié, puis `tests/e2e`            |
| `npm run validate:content`    | Valide `content/trips/` — tourne aussi en `pretest` et en `prebuild`      |
| `npm run new-trip <slug>`     | Crée `content/trips/<slug>/trip.yaml`, squelette commenté                 |
| `npm run geocode <slug>`      | Résout et écrit les coordonnées des villes du voyage                      |
| `npm run index-photos <slug>` | Mesure les photos, écrit leurs dimensions et produit les versions AVIF    |
| `npm run check:photo-weight`  | Pèse les images suivies par git, refuse au-delà de 150 Mo                 |

`validate:content` **cite** les deux commandes de réparation dans ses messages (« lance
`npm run geocode japon-2024` », « lance `npm run index-photos japon-2024` ») : le message dit
où la réparation se trouve, et les deux commandes existent. `index-photos` a longtemps été un
placeholder qui sortait en code 1 en nommant TIW-17, parce qu'un script qui existe et ne fait
rien silencieusement est un piège ; TIW-17 l'a livré, et c'est lui qui écrit `width`, `height`
et `blurDataUrl` — jamais la main.

### La boucle d'écriture d'un voyage

```bash
npm run new-trip japon-2024      # squelette commenté, sans coordonnées
#   … tu remplis les noms de villes et les codes pays …
npm run validate:content         # refuse, et dit « lance npm run geocode japon-2024 »
npm run geocode japon-2024       # liste les homonymes, demande un numéro, écrit
#   … tu déposes tes photos dans public/photos/japon-2024/ et tu écris leur alt …
npm run validate:content         # refuse, et dit « lance npm run index-photos japon-2024 »
npm run index-photos japon-2024  # mesure, écrit les trois clés, produit les AVIF
npm run validate:content         # vert
```

Les trois dernières lignes sont facultatives : un voyage sans photo est un voyage valide.
`index-photos` est la seule commande du dépôt qui **réécrit un fichier que tu as déposé** —
une image au-delà de 3000 px ou de 1,5 Mo est redimensionnée sur place, avec un avertissement
qui la nomme. Garde tes originaux pleine taille hors du dépôt.

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
Ce compromis a été **assumé en TIW-38**, quand `en` et `es` sont devenus actifs : le 404 répond
en français sous les trois préfixes, et le catch-all qui le corrigerait coûte une route `ƒ`,
donc l'invariant du prérendu. L'alarme d'alors — le test « declares exactly one active locale »
— a fait son travail et a été remplacée par deux gardes plus utiles dans `tests/smoke.test.tsx` :
chaque locale déclarée a son catalogue, et chaque catalogue porte tout le jeu de clés.

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
alors **404 pour tous les slugs**, publiés compris.

Ce paragraphe a affirmé jusqu'ici qu'un voyage sans photo obtenait « une carte avec titre et
description sans image, et `twitter:card` retombe sur `summary` ». C'était vrai quand TIW-21
l'a écrit et faux depuis TIW-23 : la marque sert d'image de repli pour toute page qui n'a
rien de mieux à montrer, la branche `summary` a été supprimée plutôt que laissée en code
mort, et `tests/app/share.test.ts` l'atteste. Un voyage sans photo obtient donc une **grande
carte portant la marque du site** — jamais le rectangle gris vide qu'un
`summary_large_image` sans image produit.

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

**Les photos.** Une photo se déclare sur le **voyage** et non sur l'étape (`photos[]`), avec un
`src`, un `alt` obligatoire non vide, et facultativement un `placeSlug` : une photo rattachée à
un lieu apparaît dans l'étape de ce lieu, une photo sans rattachement reste dans la galerie du
voyage. Les trois autres clés — `width`, `height`, `blurDataUrl` — sont **écrites par
`npm run index-photos`, jamais à la main**, comme `coordinates` l'est par `geocode` ; la
validation les exige et nomme la commande.

La conversion se fait dans la **commande d'auteur** et non au build : `next/image` est un
composant client, que ce projet a déjà refusé pour la couverture, et une conversion pendant
`next build` ferait payer ~0,7 s par photo à chaque déploiement pour un résultat que le contenu
peut porter. Les versions AVIF (480, 960 et 1440 px, jamais au-delà de la largeur de l'original)
sont donc versionnées à côté des originaux, et `validate:content` vérifie leur existence — ce
n'est pas cosmétique : un `<picture>` **s'engage** sur la `<source>` que le navigateur retient,
donc un AVIF absent est une image cassée et non un repli sur l'`<img>`. La contrepartie est le
poids du dépôt, qui devient un budget mesuré : `npm run check:photo-weight` refuse au-delà de
150 Mo, et `content/README.md` porte l'arithmétique. Le détail, seuils de redimensionnement
inclus, est dans `content/README.md`.

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
global, `src/styles/tokens.css` ; le style par composant se fait en CSS Modules à côté du
composant. **Depuis TIW-37 ce fichier ne porte plus la palette** : il importe celle de
`@thomascaron/ui`, partagée avec le portfolio, et ne déclare que ce qui est propre à ce site
(`--content-max-width`, les trois `--logo-*`). Cette ligne disait auparavant que la palette
était « volontairement identique à celle du portfolio » et que toute modification devait y
être répercutée — six jetons avaient divergé quand même, parce qu'une consigne écrite dans un
README n'est pas un garde. Le garde, désormais, est
`tests/styles/colour-contract.test.ts`.

**La marque est remplaçable sans toucher au code.** Le logotype est un **avion vu de face,
droit**, en `--logo-ink`, une aiguille de compas découpée dans son fuselage, suivi du nom sur
**deux lignes** : « Travels » dans la serif d'affichage à taille pleine, « IN WORLD » petit et
très espacé dessous. C'est le verrouillage « Deux temps », choisi par le propriétaire le
7 septembre 2026 parmi huit, et retenu pour une raison qui n'est pas esthétique : **c'est le
seul dont la hiérarchie tienne sans couleur** — taille, casse et famille disent la même chose
trois fois, donc il survit au noir et blanc, à l'impression et à un lecteur qui ne sépare
aucune teinte. Les sept autres reposaient sur un aplat, un contour ou une pastille, tous des
objets dont le contraste doit être mesuré et tenu.

C'est le troisième dessin du projet — une comète que la plupart des lecteurs prenaient pour
une plume, puis un avion incliné à 21° volant en tête d'une trajectoire pointillée, puis
celui-ci — et le premier à porter le nom dans la marque elle-même. **Deux choses ont disparu
avec ce choix**, notées ici parce qu'elles ont chacune coûté une correction :

- **le médaillon**, le disque de 6,5 rem à la couleur de la barre qui débordait sous elle. Un
  verrouillage qui épelle le nom n'a pas besoin d'une plaque, et un disque à côté d'un
  logotype sur deux lignes fait deux centres de gravité dans un même coin. Sa disparition a
  fait maigrir la barre empilée de 28 px, ce que `--chrome-height` continuait d'ignorer : le
  garde de `tests/e2e/map-interaction.spec.ts` l'a dit dès la première exécution ;
- **le nom posé à côté de la marque.** Il fait maintenant partie du verrouillage, donc le
  garder aurait imprimé « Travels in World » deux fois dans le même coin.

Le nom est **deux clés** (`brand.nameLead`, `brand.nameTail`) et non une seule coupée au
rendu : une coupure au rendu serait une règle sur le français qu'aucun traducteur ne peut
changer. Les capitales de la seconde ligne sont un `text-transform` et non une saisie, pour
que l'arbre d'accessibilité reçoive « in World » et non « IN WORLD », que certains lecteurs
d'écran épellent lettre à lettre. Et un espace explicite sépare les deux éléments : mesuré,
sans lui le nom accessible se concatène en « Travelsin World ».

**Ce qui n'a PAS changé : le favicon reste l'avion seul.** À 16 px un nom sur deux lignes est
illisible, et une seconde coupe simplifiée serait un second logo. La carte de partage, elle,
porte le même verrouillage que l'en-tête, en grand — un seul dessin sur toutes les surfaces,
ce qui était l'argument principal de la proposition retenue.

**Le dessin a changé le 7 septembre 2026, et c'est le premier de ce dépôt qui n'a pas été
dessiné ici.** Le propriétaire a fourni un PNG de 1600 × 1200 : un avion **vu de face,
droit**, avec une aiguille de compas **découpée** dans le fuselage. L'ancienne marque — un
avion incliné à 21° volant en tête d'un filet pointillé — a été retirée, et avec elle les
trois constantes du filet.

Deux choses à savoir avant d'y toucher :

1. **Le chemin a deux contours et se peint en `fill-rule: evenodd`.** Le premier est la
   cellule, le second est l'aiguille, et l'aiguille est un **trou**. Peinte avec la règle
   non nulle par défaut, elle se remplit et la marque perd son seul détail — sans erreur,
   sans avertissement. `tests/components/site/brand-art.test.ts` refuse qu'un des deux
   fichiers qui dessinent ce chemin oublie la règle.
2. **La cellule a été retracée puis réécrite à la main.** Le traceur donnait un bout d'aile
   gauche à x 0 et un droit à x 360,435 ; un logo asymétrique à 0,12 % reste un logo
   asymétrique. Chaque arête droite est exacte, les deux courbes de nez sont les mêmes deux
   cubiques en miroir, et la symétrie autour de x 36 est une propriété de la construction et
   non une mesure. L'aiguille, elle, est le contour tracé mis à l'échelle 1/5 : il est
   ressorti symétrique à 0,01 près, il n'y avait rien à corriger.

Ce que la nouvelle coupe donne à 16 px, mesuré : **34,4 % de la boîte encrée**, 44 pixels sur
256 au-delà d'alpha 200, contre 14,6 % et 22 pixels pour l'avion incliné. Une silhouette
droite vue de face est bien plus dense qu'une croix inclinée. En regard, **l'aiguille
disparaît à cette taille** — 2,4 unités dans une boîte de 72, donc un demi-pixel — et la
marque se dégrade en silhouette pleine, qui se lit encore comme un avion ; l'aiguille revient
à 32 px. C'est une acceptation, pas un oubli : une seconde coupe simplifiée pour les petites
tailles serait un second logo.

C'est une marque **typographique**, assumée comme telle : il n'y a ni police propre, ni dessin
de lettres. Cinq fichiers, une seule source de vérité, et **une commande** :

| Fichier                                     | Ce qu'il porte                                       |
| ------------------------------------------- | ---------------------------------------------------- |
| `src/components/site/brand-art.ts`          | **la géométrie** — chemins, boîtes, transformations  |
| `src/app/icon.svg`                          | le favicon, thème embarqué (copie du chemin, gardée) |
| `src/app/apple-icon.png`                    | 180 × 180, opaque, sur la plaque `--logo-bg`         |
| `public/opengraph-default.png`              | 1200 × 630, l'image de partage par défaut du site    |
| `src/components/site/site-brand.module.css` | les tailles et les états du verrouillage d'en-tête   |
| `scripts/generate-brand-rasters.ts`         | **redessine les deux PNG** depuis la géométrie       |

Pour substituer un dessin définitif : remplacer les chaînes de `brand-art.ts`, recopier le
même `d` dans `icon.svg`, puis `npm run brand:rasters`. Aucun composant, aucun test et aucune
feuille de style n'a besoin d'être modifié.

**Cette commande n'existait pas avant le 7 septembre 2026**, et c'est ce qui rendait la phrase
ci-dessus fausse en pratique : les deux PNG avaient été faits à la main, le README disait « les
régénérer » sans dire comment, et la géométrie avait une source de vérité que les rasters
n'avaient pas. Elle ne vit pas dans `npm test` — un garde qui réécrit l'artefact qu'il garde ne
peut pas échouer, et une suite qui touche `public/` à chaque exécution rend `git status`
inutilisable. Ce qui vérifie les rasters, c'est `tests/build/brand.test.ts`, qui lit leurs
en-têtes.

**Ce qui casse si les proportions changent** : le `viewBox` de la marque décide de sa largeur
pour une hauteur donnée (0,72 : 1 — plus haute que large, contrairement à l'ancienne, d'où le
médaillon qui la porte plutôt qu'une boîte carrée) ; la plaque de l'icône Apple porte la seule
couleur en dur du lot, parce qu'un PNG ne suit aucun thème ; et l'image de partage **doit**
rester en 1200 × 630, sans quoi `og:image:width` / `og:image:height` mentent et la carte se
réagence après le chargement. `tests/build/brand.test.ts` refuse ce dernier cas en lisant
l'en-tête du PNG.

Une contrainte de dessin est mesurée et ne se contourne pas — et une deuxième a disparu avec
l'ancienne marque, ce qui vaut d'être dit plutôt que silencieusement omis. **Encre contre
accent ne vaut que 1,56:1 en clair et 1,45:1 en sombre** : c'est ce qui interdisait à l'avion
incliné et à sa trajectoire de partager une arête, et ce qui les séparait par 6,68 unités de
fond nu. La marque actuelle n'a **aucune partie accentuée** — une encre, une silhouette, et un
trou qui laisse voir le médaillon — donc cette frontière n'existe plus nulle part dans le logo.
Ce qui reste dû, c'est la lecture de l'encre contre la page : **8,97:1 en clair et 10,28:1 en
sombre**. Ces chiffres sont recalculés par
`tests/styles/colour-contract.test.ts` ; la palette partagée de TIW-37 a **resserré** la
contrainte plutôt que de la desserrer (1,99 → 1,56 en clair), parce que l'accent y est un
seul teal dans les deux thèmes au lieu d'un teal sombre et d'un cyan clair.

**Le favicon ne porte plus de trajectoire, et il n'y en a plus nulle part.** Ce que la coupe
actuelle encre à 16 px est mesuré plus haut — 34,4 % de la boîte, 44 pixels sur 256 au-delà
d'alpha 200 — contre 14,6 % et 22 pixels pour l'avion incliné, et 28,8 % pour la comète encore
avant. Le sens de la série a donc changé deux fois : la marque s'était allégée, elle est
redevenue dense. Le relevé de 10,31 au pire sur les huit gris
de barres d'onglets de Chrome, Firefox et Safari **n'a pas été refait pour la nouvelle
encre** et n'est donc plus valable : la liste de ces huit gris n'est consignée nulle part
dans le dépôt, seul son résultat l'est (`docs/adr/0013`). Ce qui est mesuré, c'est le sens de
la bascule — `tests/e2e/brand.spec.ts` rastérise le favicon à 16 px et vérifie qu'il s'encre
sombre sur un système clair (luma 0,199) et clair sur un système sombre (0,827).

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
que `--border-subtle` mesure 1,17:1 et que la forme du monde est l'objet graphique
nécessaire à la compréhension ; la distinction visité / non visité est portée par un contour
en `--text-accent` **et par son épaisseur**, parce qu'aucune valeur de remplissage ne dépasse
3:1 en thème clair et qu'un canal non coloré est nécessaire.

**L'équivalent textuel de la carte, c'est la liste des balises — plus une liste de
pays.** Jusqu'au 7 septembre 2026, `src/components/map/visited-countries.tsx`
(TIW-15) rendait sous la carte les pays atteints par les voyages publiés, chacun
avec son nombre de voyages et son lien. **Le propriétaire a fait retirer ce bloc de
l'onglet Carte** ; l'inventaire vit désormais sur les onglets **Pays** (`/voyages`,
groupé par pays) et **Villes** (`/villes`, index alphabétique des lieux). Le
composant, sa feuille de style et ses tests ont été supprimés avec lui.

Ce qui porte l'équivalent aujourd'hui, et ce que ça change :

1. **Les balises.** Une par voyage, un vrai `<a href>`, nommée « titre, lieu » — et
   « — récit à venir » pour un voyage sans récit. Le `<svg>` est `aria-hidden`
   (ADR 0003), donc c'est cette liste-là, plus le `<figcaption>` compté, qui
   satisfait la 1.1.1. Elle est dans le HTML que le serveur envoie :
   `tests/e2e/map-equivalent.populated.spec.ts` le vérifie octet par octet.
2. **Une dette de 1.4.1, nommée et datée.** Depuis TIW-38 la distinction
   raconté / non raconté dans le dessin est cuivre contre teal — une différence de
   teinte seule — et c'était la liste supprimée qui la portait aussi en toutes
   lettres, visiblement. Elle est **inerte aujourd'hui** : les treize voyages
   publiés sont tous `story: unwritten`, donc la carte ne peint qu'une teinte. Elle
   devient réelle **au premier récit publié**, et la réparation est alors une
   différence de _forme_ dans le dessin, pas une liste à faire défiler.
   `src/components/map/world-map.module.css` et `src/app/[locale]/page.tsx` la
   portent tous les deux.
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

Et la leçon qui a survécu à la suppression, parce qu'elle vaut pour tout lien de ce
dépôt : **jamais un fragment vers une section qui peut ne pas exister.** La liste
supprimée pointait `/voyages#pays-<code>` et **ça pendait dans le vide** —
`buildCatalogue` classe un voyage sous son **pays de première arrivée** seulement,
donc un pays seulement _traversé_ n'a aucune section, et `#pays-bo` ne
correspondait à rien (mesuré sur un build de production). Un fragment sans cible
n'échoue pas : il dépose le lecteur en haut d'une longue page. La mesure est
conservée dans l'en-tête de `tests/e2e/dead-links.populated.spec.ts`, le garde
qu'elle a payé.

L'énumération masquée des pays visités qui vivait dans le `<figcaption>` a été
**retirée** dès TIW-15 : un `<figcaption>` est le **nom accessible** du `<figure>`
(HTML-AAM), et quarante noms de pays dans un nom accessible n'est pas un libellé.
Elle n'est pas revenue avec la suppression de la liste, et
`tests/components/map/world-map.test.tsx` est ce qui l'en empêche.
`docs/adr/0003-carte-svg-inerte-et-balises-html.md` en décrit encore l'ancienne
version : à reprendre avec TIW-27.

**La recherche de l'en-tête est le TROISIÈME `'use client'` du jalon**, et c'est la seule
chose de ce dépôt qui ait dépassé le budget de deux. L'argument est dans l'en-tête de
`src/components/search/site-search.tsx` ; le résumé tient en trois points.

1. **Ce qui a été demandé est de l'interaction.** Filtrer une liste à chaque frappe, sans
   aller-retour serveur — et il ne peut pas y en avoir : toutes les routes sont prérendues,
   donc une page de résultats `?q=` se rendrait à la demande, ce qui est l'invariant 1.
2. **La frontière est aussi mince que possible.** Tout ce qui n'est pas de l'interaction vit
   dans `src/components/search/entries.ts`, un module pur avec vingt cas : construction de
   l'index, pliage des accents, règle de correspondance. Le composant client n'a qu'une
   boucle de filtre, une carte de touches et deux écouteurs.
3. **Les lignes ne sont pas des props.** Elles arrivent en `children`, déjà rendues par le
   serveur — le même geste que `MapViewport` avec ses balises et ses cartes. L'index existe
   donc **une seule fois**, en HTML, et n'est jamais aussi sérialisé dans la charge utile.

**LE CHAMP EST OUVERT EN PERMANENCE ET LA DIVULGATION EST DU CSS**, depuis que le
propriétaire a choisi cette direction sur une planche de cinq. Il n'y a plus de `<summary>` :
un champ de 20 rem vit dans la barre, et ce qui ouvre le panneau est `:focus-within` dans la
feuille de style. Le lecteur sans JavaScript tabule dans le champ et **l'index complet du site
apparaît** — chaque voyage, chaque lieu, chaque pays, chaque page, en liens réels — sans un
clic. C'est strictement mieux que la divulgation que ça remplace. Le script n'a qu'un mot à
dire : `data-dismissed`, écrit sur Échap, effacé à la frappe suivante. Le cadre du champ est
un `<label>` et non un `<div>`, ce qui rend toute la pastille cliquable sans une ligne de
script — et c'est ce qui la sauve sur une barre étroite, où l'entrée fait zéro pixel de large.

**Les lignes sortent de l'ordre de tabulation, et c'est le CLIENT qui les en sort** — le seul
endroit du dessin où les deux lecteurs reçoivent un DOM différent. Le panneau s'ouvrant au
focus, la tabulation suivante entrait dedans : mesuré, `map-equivalent.populated.spec.ts`
n'atteignait plus les balises de la carte en trente pressions, vingt et une suggestions
s'étant intercalées entre l'en-tête et la page — sur chaque document du site. Un
`tabIndex={-1}` rendu par le serveur réparerait ça et casserait l'autre lecteur, celui pour
qui ce panneau **est** l'index et Tab la seule façon d'y circuler. L'attribut est donc écrit
au montage : avec script, le marché du combobox — les flèches pour entrer, Entrée pour suivre,
Tab pour passer outre ; sans script, une liste entièrement tabulable. Les flèches déplacent le
**vrai focus** sur le **vrai lien**, donc Entrée, clic du milieu et Cmd-clic marchent parce que
ce *sont* des liens.

**Les suggestions d'un voyage sont illustrées** — la seconde moitié du choix du propriétaire.
Une vignette et une seconde ligne « pays · N étapes · année ». **La vignette est le vrai pays**,
au 50m, ajusté à son propre cadre par `src/map/country-tile.ts`, avec le point sur la ville de
départ — le point même où la carte ancre sa balise.

Deux pièges valaient d'être mesurés. Le premier ajustement prenait **tout** le tracé : la
France du 50m porte la Guyane, la Réunion, la Martinique et Mayotte, si bien que la métropole
sortait à huit unités de large dans une boîte de quarante, Rouen et la Corse à 3,8 unités l'un
de l'autre. L'ajustement se fait donc en deux passes — sur la plus grande masse, puis sur elle
plus les anneaux qui tombent près du cadre : la Corse, les Baléares et la Crète entrent, la
Guyane et les Canaries restent dehors. Et le tracé brut pesait 23,6 Ko pour cinq pays :
Douglas-Peucker à un tiers de pixel, puis grille au demi-pixel, le ramène à **3,3 Ko** — trois
fois moins qu'une grille seule, pour un écart que personne ne voit. Un `<symbol>` par pays,
donc neuf voyages français coûtent une France.

Un fanion volait au bout de chaque ligne ; le propriétaire l'a fait retirer. Rien n'est perdu
pour un lecteur qui ne voit pas la couleur, et c'est la seule raison qui l'autorisait : la
seconde ligne finit déjà par les mots « récit à venir ».

**La complétion en ligne** est native et non un fantôme posé à côté du champ : l'entrée porte
le libellé entier et la part au-delà de ce qui a été tapé est **sélectionnée**, donc la frappe
suivante la remplace. Une seconde boîte devrait être alignée à la main sur une fonte
proportionnelle ; une sélection l'est par construction. Jamais sur une suppression — sinon
Retour arrière remet le texte qu'on l'a pressé pour retirer. Et la décision se prend dans le
gestionnaire de frappe, pas dans un effet : mesuré, l'effet rendait une fois avec la nouvelle
requête et l'ancienne complétion, si bien que deux Retour arrière sur « Islande, cercle d'or »
laissaient « i » au lieu de « Is ».

**Ce que ça coûte, mesuré.** L'index est dans le HTML de **chaque** document, parce que le
chrome l'est. Sur le contenu réel — 13 voyages, 36 lignes — c'est **11,7 Kio de balisage**,
qui portent une page de contenu de 7,7 à 10,0 Kio brotli, et **+1,3 Kio de JavaScript initial**
(`/fr` passe de 123,2 à 124,6 Kio pour un plafond de 150). C'est linéaire dans le contenu :
soixante voyages font environ cent lignes et 32 Kio de balisage. Le plafond est donc posé —
24 Kio dans `tests/build/prerender.test.ts` — avec sa porte de sortie chiffrée : au-delà,
l'index devient un fichier JSON committé que le panneau va chercher au premier focus, ce qui
coûte une requête, un mode de panne et un fichier à tenir en phase.

**Il n'y a aucun corps de récit à indexer, et c'est une propriété du modèle.**
`src/domain/schema.ts` donne à un voyage un titre, des lieux, des étapes, des photos et des
tags — rien qui porte de la prose. « Chercher dans le texte des récits » se résout donc aux
**légendes des photos et aux tags**, seul texte libre qu'un récit possède, et les deux sont
repliés dans la botte de foin du voyage. Le jour où un champ de corps existe, c'est
`buildSearchEntries` qui l'accueille : un cas de `tests/components/search/entries.test.ts` le
dit en toutes lettres, pour que l'absence soit une décision consignée et non un manque que
quelqu'un redécouvrira.

Quatre défauts que seul le navigateur a vus, notés parce qu'ils se reproduiraient.
**Les intitulés de groupe étaient des `<h2>`** et, l'en-tête précédant `<main>`, ils faisaient
commencer le plan de titres de chaque page au niveau 2 — cinq cas de
`heading-order.populated.spec.ts` d'un coup ; ce sont des `<p>` reliés par `aria-labelledby`.
**Le panneau s'ouvrait sous le logo** : `.inner` est une grille à trois colonnes dont celle
du milieu centre la navigation, un quatrième enfant a pris la première cellule, vide par
construction. La recherche et le menu de langue partagent maintenant une même zone à droite.
**Vingt et une suggestions s'étaient glissées dans le parcours clavier** de chaque page, dit
plus haut. Et **la région défilante n'était plus atteignable au clavier** une fois les lignes
sorties de la tabulation — `scrollable-region-focusable`, sérieux, dans les deux thèmes : le
défilement, le nom accessible et un unique `tabindex="0"` sont maintenant sur le même élément,
un arrêt juste après le champ qui annonce les suggestions et passe la main aux flèches.

**Les filtres des deux listings n'ont PAS pris de quatrième `'use client'`**, et c'est la
décision à connaître avant d'en toucher un. `/fr/voyages` et `/fr/villes` portent un groupe
de boutons radio au-dessus de leur liste ; ce qui masque les entrées est une **feuille de
style générée au build**, une règle par choix, imprimée dans le document. Le budget reste
donc à **trois**.

1. **Pourquoi pas d'état.** Toutes les routes sont prérendues, donc une page `?pays=FR` se
   rendrait à la demande — l'invariant 1. Et un filtre est une _sélection_, pas une
   interaction : un groupe de radios se souvient tout seul de ce qui est coché, les flèches
   y déplacent le choix, un `<label>` élargit la cible. `:has()` lit l'état depuis le CSS.
   Rien de tout cela n'a à être réécrit.
2. **Un seul choix actif, tous axes confondus**, et ce n'est pas une limitation subie :
   toutes les radios d'une page partagent un `name`, donc choisir une année efface un pays.
   Deux propriétés en découlent. Le nombre écrit sur chaque pastille est **exactement** ce
   qui reste — croisé avec un second axe, il faudrait un nombre par combinaison, ce que le
   CSS ne sait pas calculer — et **un résultat vide devient inatteignable** plutôt
   qu'arbitré, puisqu'un choix n'existe que pour une valeur que la collection porte. C'est
   le même geste que les deux bandeaux mutuellement exclusifs de l'accueil.
3. **Les axes sont choisis sur le contenu réel, pas sur l'habitude.** `/voyages` filtre par
   **pays traversé** et par **année de départ** ; `/villes` par **pays**. Continent, état du
   récit et tags ont été écartés parce qu'ils n'ont qu'une valeur aujourd'hui — et c'est
   `buildFacetIndex` qui les écarte, pas un `if` : un groupe à une seule valeur est
   supprimé, donc l'axe réapparaîtra tout seul le jour où le carnet sortira d'Europe.
   Le pays est celui de **toutes** les étapes et non celui du classement : `buildCatalogue`
   range un voyage sous sa première arrivée et notait le prix de ce compromis — « le jour
   où ça devient le mauvais arbitrage est le jour où les filtres arrivent ».

**Ce que ça coûte, et ce qui le prouve.** La feuille générée est linéaire dans le nombre de
choix — deux règles par valeur — et vaut aujourd'hui une poignée de lignes sur `/fr/voyages`.
Zéro octet de JavaScript : il n'y a rien à hydrater. Le seul garde possible est un navigateur,
parce qu'aucune assertion Node ne distingue une feuille appliquée d'une feuille absente :
`tests/e2e/filters.populated.spec.ts` coche un filtre sur un build réel, compte ce qui reste,
passe axe, et **refait la même chose avec JavaScript désactivé** — ce dernier cas est le garde
du budget de frontières, pas une politesse.

**La quatrième teinte de la carte — les pays « à venir »** (Croatie, Italie, Portugal,
Monténégro) — tient dans `content/wishlist.yaml`, quatre lignes de codes ISO que
`npm run validate:content` juge avant chaque build : un code que le fond de carte 50m ne
sait pas dessiner est nommé un par un, et un pays déjà visité est refusé parce que la carte
peint une forme une fois et que les deux teintes se recouvriraient.

**Le survol n'a pas rendu le dessin interactif**, ce qui était l'écueil : le SVG reste
`aria-hidden` et sans `pointer-events`, et la note est du HTML posé dessus, sur un point
que `src/map/anchor.ts` calcule à l'intérieur de la forme — la même mécanique qu'une
balise, donc les deux zooment ensemble. `docs/adr/0003` porte l'arbitrage complet ; les
trois points qui décident du reste :

- **l'étiquette est dans le document en permanence**, masquée visuellement, et le survol ne
  fait que la peindre. Une synthèse vocale lit les quatre notes au repos — c'est ce qui
  autorise l'absence de `tabindex`, car un arrêt de tabulation dont le seul effet serait de
  révéler un texte déjà lu est un arrêt qui n'existe pour personne ;
- **une phrase visible dans la légende** pour le lecteur que ni le survol ni les notes ne
  servent : celui qui voit et n'a pas de survol. Elle est `aria-hidden`, parce qu'une
  `<figcaption>` est le nom accessible de la figure et que la phrase dans ce nom a fait
  rougir trois cas d'un coup ;
- **la teinte ne porte pas l'état seule** : le contour est tireté, donc la différence
  survit au niveau de gris et aux deux thèmes.

WCAG 1.4.13 est mesuré et non affirmé : `tests/e2e/wished.populated.spec.ts` révèle une
note et vérifie balise par balise qu'elle n'en recouvre aucune.

**Dépendances écartées** (délibérément, ne pas les rajouter sans ticket) : bibliothèque de
carte côté client (Leaflet, MapLibre), gestionnaire d'état (Redux, Zustand), client HTTP ou
React Query, bibliothèque de formulaires, Tailwind, bibliothèque d'icônes React
(`@tabler/icons-react` a été retirée : les icônes sont du SVG rendu au build, pas des
composants client). Avec des Server Components et un contenu
versionné, il n'y a ni état client à partager ni données à aller chercher.

**Les liens de la page « À propos » vivent dans un seul fichier**, et trois y sont
volontairement vides : `src/app/[locale]/a-propos/identity.ts`. Le portfolio, le compte
Instagram et l'adresse de contact appartiennent à l'auteur et n'ont pas été inventés. Un
lien absent n'est **pas rendu du tout** — jamais de `href="#"`, jamais de « lien à venir » —
et un lien renseigné de travers **fait échouer le build**, avec la clé et la valeur dans le
message, comme `src/app/site-url.ts` le fait pour l'origine du site. Pour en remplir un :
remplacer le `null` par la valeur dans la forme que le commentaire du champ donne, puis
`npm test`. Rien d'autre ne change dans le code. Deux tests passeront au rouge, et c'est
voulu : ils sont écrits pour rendre ce remplissage visible dans un diff
(`tests/app/identity-links.test.tsx`, `tests/e2e/about.spec.ts`).

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
`test:lint`, `check:photo-weight`, `build`, `test:build`, `test:e2e`. Trois jobs en parallèle — les vérifications
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
