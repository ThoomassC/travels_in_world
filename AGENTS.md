<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Contenu projet : écrit à la main, hors des marqueurs ci-dessus.
     `next dev` ne réécrit que la région BEGIN/END, ce bloc est donc préservé. -->

# travels_in_world — à savoir avant d'écrire une ligne

Journal de voyages : une carte du monde semée de balises, chaque voyage raconté en frise
chronologique d'étapes. Contenu en fichiers versionnés, aucune base de données.

## Les trois invariants

**1. Tout est prérendu au build. C'est le pari central du projet.**
Toute lecture d'en-tête de requête **au-dessus** du segment `[locale]` — layout racine ou
`not-found.tsx` global — dé-statifie l'arbre entier, `/fr` compris. `next build` sort alors
en **code 0** avec un « ✓ Generating static pages » trompeur : aucun signal. La garde est
`npm run test:build`, qui lit `.next/prerender-manifest.json` et exige `/fr` et
`/_not-found`. Elle a été prouvée par un échec volontaire. Ne la contourne pas, ne la
désactive pas : lance-la après toute modification d'un layout, du 404 ou des métadonnées.

**2. Navigation interne : jamais `next/link` ni `next/navigation`.**
Utilise `Link`, `redirect`, `usePathname`, `useRouter` depuis `@/i18n/navigation`, sinon le
segment de locale est perdu. Une règle ESLint le refuse partout sauf dans
`src/i18n/navigation.ts`. Angle mort connu et non couvert : `await import("next/link")`.

**3. Server Components par défaut.**
Le jalon 1 n'autorise que deux composants `'use client'` : l'interaction de la carte et la
visionneuse photo. **La seconde est dépensée** — `src/components/photos/photo-lightbox.tsx`,
livrée par TIW-17 ; il n'en reste donc qu'une, celle de la carte (TIW-14). Tout autre
`'use client'` se justifie en revue. `src/domain/**` reste du TypeScript pur — ni React, ni
Next, ni `fs`, ni `d3`, ni `sharp`.

`src/map/**` s'atteint par sa façade `@/map`, **seul** module du dossier à porter
`import "server-only"` : le build casse si un composant client l'atteint. Les quatre modules
internes en sont nus, délibérément, pour rester chargeables par Vitest et par les scripts
Node. C'est la règle ESLint `travels-in-world/map-entry-point` qui interdit à tout `src/**`
hors `src/map/**` de les importer en profondeur — ainsi que `world-atlas`, `d3-*` et
`topojson-*` — et `tests/lint/map-entry-point.test.ts` qui prouve qu'elle refuse vraiment. Un
`import type` depuis la façade est effacé à la compilation et ne déclenche pas le guard :
c'est la façon de partager un type de frontière sans importer de code. Voir
`docs/adr/0002-facade-serveur-gardee.md`.

`src/iso-3166.ts` est le seul module à la racine de `src/`, et il l'est depuis TIW-29. C'est
la transcription des 249 codes ISO 3166-1 alpha-2 attribués, avec deux consommateurs dans deux
couches qui ne peuvent pas s'atteindre : la jointure de `src/map/world.ts`, et le prédicat
`isAssignedCountryCode` dont `src/content/validate.ts` a besoin pour refuser un code pays
qu'aucune carte ne peut dessiner. Les trois autres routes ont été mesurées et écartées — la
façade `@/map` échoue à la _résolution_ sous Node nu (`Cannot find package 'server-only'`),
l'import profond `@/map/iso-3166` est refusé par `map-entry-point`, et une troisième copie des
249 lignes ne se justifiait pas. `src/domain/**` continue de ne pas pouvoir l'atteindre —
`domain-purity` refuse tout `@/*`, mesuré — ce qui est exactement ce qui garde
`docs/adr/0001-domain-purity.md` intact : le domaine valide la _forme_ d'un code, ce module
connaît le monde, et `src/content` est la couche qui refuse du contenu. L'en-tête du module
porte les trois mesures.

`src/content/**` **ne le porte pas**, délibérément : c'est du code Node exécutable, que
`npm run validate:content`, `npm run geocode`, `npm run new-trip` et Vitest chargent sous Node
nu, hors contexte React, où `server-only` jette. Un alias Vitest peut neutraliser ce paquet en
test ; aucun alias ne s'applique aux scripts CLI, et c'est eux qui décident.

**Le garde est posé — c'est fait, depuis TIW-11** — et il vit sur **un seul** fichier,
`src/content/trips.ts` : `import "server-only"` en première instruction, puis des réexports,
et rien d'autre. Toute la logique de chargement est dans `src/content/loader.ts`, sans garde,
pour rester chargeable par un script et par Vitest. Le split n'ouvre pas une seconde porte
d'entrée : la règle ESLint `travels-in-world/content-facade` interdit à **tout `src/**`**
d'importer autre chose que `@/content/trips` sous `@/content/` — moins le dossier qui possède
la règle (`src/content/**`), celui qui est gardé plus strictement (`src/domain/**`) et les
specs co-localisées, qui n'entrent dans aucun bundle client. Le périmètre est `src/**` et non
`src/app/** + src/map/**` pour une raison mesurée : six fichiers plausibles, dont
`src/components/photo-viewer.tsx`, atteignaient le lecteur de disque non gardé avec un lint
vert. `tests/lint/content-facade.test.ts` prouve que la règle refuse vraiment — y compris les
orthographes relatives, la leçon la plus chère du dépôt, et `await import()`, que
`no-restricted-imports` ne voit pas et qu'un `no-restricted-syntax` attrape à sa place.

Les deux façades se recouvrent, et `eslint.config.js` le paie en répétitions volontaires :
`no-restricted-imports` et `no-restricted-syntax` se résolvent par « la dernière config qui
matche gagne », et les options du dernier bloc **remplacent** celles des précédents au lieu de
fusionner. Le bloc `content-facade` répète donc la frontière de la carte, `map-internals` la
lève à l'intérieur de `src/map/**` — où `d3-geo`, `topojson-client` et `world-atlas` sont chez
eux — et `i18n-navigation` relève les deux tout en levant la seule interdiction de navigation.
Aucune de ces répétitions n'est de la redondance : supprimer l'une d'elles fait rougir
`npm run test:lint`, et rien d'autre. Une nuance mesurée pendant TIW-27 : c'est vrai des
**répétitions**, pas de `map-internals`, qui est une _exemption_ — le neutraliser casse
aussi `npm run lint` sur quatre fichiers réels de `src/map/**`. Et attention au piège
inverse, mesuré et documenté nulle part ailleurs : écrire `["error"]` seul dans un bloc
plus tardif n'annule pas les options du bloc antérieur, il les **hérite**.

Ce que les tests couvrent, et ce qu'ils ne couvrent pas : le seul exécuteur réel de
`server-only` est le bundler de `next build`, qu'aucun test de ce dépôt n'exerce. Les tests
prouvent que la ligne n'a pas été supprimée, qu'elle est toujours la première instruction, et
que la frontière ESLint mord. Le reste a été prouvé par échec volontaire — voir « Les quatre
gardes exécutables » pour la sortie réelle et pour ce qu'elle apprend sur la répartition entre
les deux gardes.

## Dépendances écartées, délibérément

Aucun Tailwind (CSS nu avec custom properties). Aucune bibliothèque de carte : la carte est
du SVG calculé au build par d3-geo, **0 Ko de bibliothèque côté client**. Aucun gestionnaire
d'état, aucun client HTTP ni React Query, aucune bibliothèque de formulaires, aucun
CSS-in-JS. Aucune bibliothèque de lightbox ni d'animation : la visionneuse photo est un
`<dialog>` natif, dont le piège de focus, l'`Échap` et le `::backdrop` sont gratuits.

**`sharp` est déclaré depuis TIW-17, et il a coûté zéro paquet.** Il était déjà sur le disque
à chaque installation : `next@16.3.1` le porte en dépendance _optionnelle_ pour son propre
optimiseur d'images, donc `npm ls sharp` le montrait dédupliqué sous `next` avant ce ticket.
Le déclarer a ajouté **0 paquet** et fait passer `node_modules` de 575 à 576 Mo — le bump
0.35.3 → 0.35.4, rien d'autre. Ce que la déclaration achète, c'est l'honnêteté : dépendre
d'une dépendance transitive, c'est dépendre de quelque chose qui peut disparaître dans un
patch d'autre chose. Il ne vit que dans `src/content/photo-files.ts`, que seul
`scripts/index-photos.ts` atteint, et la règle `content-facade` rend ça structurel — donc il
ne pèse jamais sur un bundle client, ce que le relevé ci-dessous vérifie de fait.

Avant d'ajouter une dépendance, vérifie le budget : `npm run test:build` mesure
le JS initial, à **123,2 Ko brotli sur `/fr` pour un plafond de 150 Ko** — il reste
**26,8 Ko** (mesuré sur `develop` @ `5c5bf34`, après TIW-14). La marge qui compte est celle
de la route la plus lourde, pas la moyenne : `/_not-found` en est à 111,2 Ko et sa marge de
38,8 Ko ne finance rien. Les ADR portent des relevés **datés** de leur décision — ils ne
sont pas réécrits quand le chiffre bouge, et ce paragraphe est le seul à dire l'état
courant.

Depuis TIW-12 il y a un **second** budget, que ce paragraphe est le seul endroit à réunir
avec le premier : les tracés du planisphère sont plafonnés à **34 Ko brotli**, mesurés à
30,1 Ko avec le millésime `world-atlas` 110m. Ce n'est pas du JS — c'est de la donnée de
chemin dans le HTML — donc les deux plafonds ne se financent pas l'un l'autre. Le garde est
`tests/map/world.test.ts` : passer au millésime 50m ferait 182,5 Ko et le rougirait, ce qui
est voulu.

## Versions figées, et pourquoi

**TypeScript `~5.9.3`** : ne bump pas vers 7.x. TypeScript 7 n'expose plus l'API classique
du compilateur, ce qui casse `typescript-eslint` **et** le typecheck intégré de `next build`.
À lever quand `typescript-eslint` publiera une majeure acceptant `>=7`.
**Node 24.x** (`.nvmrc`, `engines`) pour l'alignement avec Vercel.

## Les cinq gardes exécutables

Cinq invariants de ce projet ne se défendent ni par le typage ni par une revue de code :
ils se cassent en silence, avec un build vert. Chacun a donc un test qui lit un artefact
réel, et chacun a été prouvé par un échec volontaire. **Ne les désactive pas.**

| Commande                     | Ce qu'elle garde                                       | Ce qui se passe sans elle                                         |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `npm run test:build`         | `/fr` et `/_not-found` sont bien prérendus             | le prérendu disparaît, `next build` sort en 0                     |
| `npm run test:build`         | aucun voyage `draft: true` n'est prérendu              | un brouillon part en ligne, et personne n'en est averti           |
| `npm run test:lint`          | la frontière de pureté de `src/domain` mord vraiment   | la règle existe et ne refuse plus rien                            |
| `npm run test:lint`          | `@/content/trips` reste la seule porte vers le contenu | le lecteur de disque non gardé s'importe de partout dans `src/**` |
| `npm run check:photo-weight` | les images suivies par git restent sous 150 Mo         | le dépôt grossit d'un commit à l'autre, et git ne rend rien       |

Les quatre premières exigent une étape préalable — `test:build` a besoin d'un build,
`test:lint` de charger tout le graphe de configuration d'ESLint — et vivent donc hors de
`npm run test`. `check:photo-weight` n'exige rien : il interroge `git ls-files`, coûte ~0,2 s,
et vit hors de `npm run test` pour une autre raison — c'est une propriété du _dépôt_ et non du
code, et elle n'a rien à faire dans une suite unitaire.

Histoire du **poids du dépôt** : c'est le seul budget de ce projet qui grossit sans que
personne décide de le dépenser. Chaque clone le paie, chaque job d'intégration continue le
paie, et la plateforme le paie **encore** à chaque build, parce qu'un build part d'un clone.
Prouvé par échec volontaire : un fichier de 160 Mo indexé sous `public/photos/` fait sortir la
commande en 1 en nommant le fichier. Au-delà du seuil, la réponse est le stockage externe et un
`src` en URL absolue — un changement de contenu, pas de structure — ce qui est précisément
pourquoi ce garde peut se permettre de refuser plutôt que d'avertir.

**Elles sont branchées, depuis TIW-22** — et cette ligne a dit successivement le contraire de
la vérité dans les deux sens, ce qui est la raison de la préciser plutôt que de l'abréger.
`.github/workflows/ci.yml` lance les quatre gardes sur chaque pull request et sur chaque
poussée vers `main` et `develop`, et la protection de branche fait de la vérification
`Vérifications` un préalable à toute fusion : une PR rouge n'est pas fusionnable, administrateur
compris sur `main`. Le hook `prebuild` de `package.json` lance `validate:content` avant **tout**
`npm run build`, ce que ni la CI — qui construit et valide dans deux jobs séparés — ni
`vercel.json` ne couvraient : c'est ce qui empêche un contenu fautif d'atteindre le prérendu,
où il échouait avec un message renvoyant à la validation qui venait de le déclarer sain
(TIW-29). `vercel.json` lance en plus `validate:content` puis `test:build` dans le
build de déploiement lui-même — pas par redondance, mais parce que le garde des brouillons
dépend de `TIW_DRAFTS`, qui vit dans le tableau de bord Vercel et n'existe pas sur le runner
GitHub : la machine qui construit le déploiement est la seule à pouvoir constater qu'un
brouillon part en ligne.

Ce que ça ne dispense pas de faire : **lance-les toi-même** avant de pousser après avoir touché
un layout, le 404, les métadonnées, une règle de frontière ou le filtre de publication. La CI
te dira que c'est cassé quatre minutes plus tard ; elle ne te dira pas pourquoi aussi bien que
la sortie que tu as sous les yeux.

Histoire de **la pureté du domaine** : la règle a régressé **deux fois** en un seul ticket —
un glob qui ne couvrait pas les fichiers `.tsx`, puis un motif qui laissait passer
l'orthographe `./../` là où `../` était refusée. Dans les deux cas la règle existait et ne
gardait plus rien. Écrire le test a en outre révélé que trois de ses quatre motifs étaient
inutiles : `".."` couvre à lui seul les six orthographes relatives.

Histoire de **la porte unique vers le contenu** : le périmètre de la règle de façade ne
couvrait que `src/app/**` et `src/map/**`. Mesuré à l'API Node d'ESLint, six fichiers — dont
`src/components/photo-viewer.tsx`, exactement là où TIW-17 pose la visionneuse photo —
importaient `@/content/loader` avec un lint vert. Le périmètre est désormais `src/**`, moins
ce qui possède la règle (`src/content/**`), ce qui est gardé plus strictement
(`src/domain/**`), la seule exemption de navigation et les specs co-localisées.

Histoire du **filtre de publication** : il ne masquait un brouillon que si `NODE_ENV` valait
exactement `"production"`, et publiait pour toute autre valeur. Or `next build` **conserve**
une `NODE_ENV` pré-posée (`node_modules/next/dist/bin/next:84`). Mesuré avec une page sonde
appelant vraiment la façade et une clé calculée que le bundler ne peut pas replier :
`NODE_ENV=test npm run build` donne `inlined="production" real="test"`, donc la fuite ne
traversait pas le build — le bundler replie `process.env.NODE_ENV` en littéral. Mais la
garantie était **empruntée à un détail d'implémentation de Next**, et tout consommateur non
bundlé (Vitest, un futur script Node appelant `loadTrips()`) publiait les brouillons. Le
filtre est désormais _fail-closed_ et s'appuie sur `NEXT_PHASE`, mesuré posé au build
(`node_modules/next/dist/build/index.js:1212`) et **non replié**. Ne le « simplifie » pas en
`NODE_ENV !== "development"` : ce serait revenir à une valeur par défaut ouverte sur le seul
champ de ce projet qui décide qu'un contenu est privé.

Une nuance sur ces quatre lignes, à ne pas surestimer : le seul exécuteur réel de
`server-only` est le bundler client de `next build`, et aucun test de ce dépôt ne l'exerce.
La garde a été prouvée par échec volontaire — un composant `'use client'` atteignant
`@/content/trips`, directement puis via un module relais, fait sortir `next build` en 1. À
noter, parce que c'est là que passe la frontière entre les deux gardes : le relais importait
`@/content/trips`, le module _autorisé_, donc **ESLint l'acceptait** et le bundler seul a
refusé. Le lint ferme le chemin d'import, le bundler ferme la traversée client.
