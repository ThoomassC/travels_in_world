# 2. La façade est le seul module gardé

- **Statut** : accepté
- **Date** : 2026-08-21
- **Contexte du ticket** : TIW-12 (géométrie du planisphère)

## Contexte

`src/map/**` transforme le TopoJSON `world-atlas` en chemins SVG **au moment du
build**. Le pari est que le navigateur ne reçoive rien de cette machinerie : ni
d3-geo, ni topojson-client, ni surtout les 105 Ko du jeu de géométries. Aucun type
ne défend ce pari. Un composant `'use client'` qui importe un module de la carte
embarque toutes ses dépendances transitives, et `next build` reste vert : la page
grossit, c'est tout, ce qui est invisible sans rapport de bundle. C'est la forme
exacte de l'invariant 1 d'`AGENTS.md` — un build qui réussit pendant que la
garantie a disparu.

`import "server-only"` est la seule réponse mécanique à ça. Mais il a une
propriété qui décide de tout ce qui suit : **ce n'est pas un paquet de ce dépôt.**
Il vit dans `node_modules/next/dist/compiled/server-only`, où seul le bundler de
Next l'alias. `require.resolve("server-only")` répond `MODULE_NOT_FOUND`. Vitest
échoue **à la résolution** — `Failed to resolve import "server-only" from
"src/map/index.ts"` — ce qui n'est pas un test rouge mais un fichier de tests qui
ne se charge pas du tout. Et `tsc --noEmit` passe, `noUncheckedSideEffectImports`
compris : le compilateur ne voit rien.

Le guard est donc en tension avec deux autres consommateurs du même code, qui
tournent tous les deux hors du bundler : Vitest, et les scripts Node de
`scripts/**` (`npm run validate:content`). `src/content/**` a rencontré le
problème le premier, et `AGENTS.md` le consigne dans l'invariant 3. TIW-12 ajoute
un second dossier de la même forme. La réponse cesse donc d'être un cas
particulier et devient un motif, ce que cette ADR fixe.

## Décision

Par dossier serveur — `src/map/**` aujourd'hui, `src/content/**` le jour où
TIW-11 lui donnera sa façade :

1. **Un seul module porte le guard : la façade** (`src/map/index.ts`), et elle ne
   fait rien d'autre que réexporter. Son contenu est la ligne de guard suivie
   d'une liste de `export { … } from "./…"`.
2. **Les modules internes en sont nus.** Cinq des six modules de `src/map/**` ne
   portent pas le guard, délibérément, pour rester chargeables par Vitest et par
   les scripts Node.
3. **Une règle `no-restricted-imports` par dossier** interdit à tout `src/**` —
   hors le dossier lui-même et hors les specs co-localisées — d'importer ces
   modules en profondeur, **et interdit aussi les bibliothèques que le dossier
   encapsule** : `world-atlas`, `d3-*`, `topojson-*`.
4. **Chaque règle a un test qui la voit refuser quelque chose**
   (`tests/lint/map-entry-point.test.ts`), sur le modèle et pour les raisons de
   l'ADR 0001.
5. **Un `import type` depuis la façade est légitime** et n'active pas le guard :
   `verbatimModuleSyntax` l'efface avant toute résolution. Mesuré vert sous
   Vitest, `tsc --noEmit` et ESLint depuis `src/components/**`. C'est la façon de
   partager un type de frontière sans importer de code.

Le groupe de motifs retenu est `["@/map/*", "**/map/*"]`, **sans négation**, et
chacune de ses propriétés a été mesurée sur 21 orthographes :

- `@/map` passe, et il n'existe aucune exception écrite pour lui : `@/map/*` exige
  un segment après la barre, donc le répertoire nu n'est pas attrapé. Quiconque
  « range » le groupe en `@/map*` ou `@/map/**` casse ce cas et lui seul.
- `@/map/index` est refusé, volontairement. Le chemin canonique de la façade est
  `@/map` ; admettre une seconde orthographe donne au même module deux écritures
  dont une seule est greppable.
- `**/map/*` attrape les trois orthographes relatives, qui désignent le même
  module que `@/map/*` pour le bundler.

Ce qui attrape les chemins profonds n'est pas le `**` : `*` **ne franchit pas** un
`/`. C'est la règle de l'ancêtre — un répertoire matché entraîne tout ce qu'il
contient, comme une entrée de `.gitignore` — déjà documentée dans
`eslint.config.js`, et c'est pourquoi `*` et `**` ne montrent aucun écart sur les
21 orthographes.

### Alternatives écartées

**(a) Le guard sur chaque module du dossier.** Rend la géométrie et le contenu
intestables hors du bundler Next et casse les scripts CLI : chaque import statique
de `tests/map/**` échoue à la résolution, et `npm run validate:content` — du
`node` nu — ne peut plus charger le dossier. Le correctif aurait l'air d'appartenir
à `vitest.config.ts`, c'est-à-dire à (b).

**(b) Un alias vers un module vide dans `vitest.config.ts`.** Neutralise le guard
pour toute la suite, présente et future, et exige la même modification dans les
**trois** configurations Vitest — `vitest.config.ts`, `vitest.build.config.ts`,
`vitest.lint.config.ts` — dont la dernière est précisément l'endroit où une autre
frontière compte sur l'absence de cet alias. Un alias global pour défendre une
frontière locale est un mauvais échange.

**(c) La façade sans règle ESLint.** Un import profond depuis `src/app/**` la
contourne, build vert. Une façade que rien n'empêche de contourner ne garde rien.

**(d) Le type de frontière redéclaré côté consommateur.** C'est ce que TIW-13
avait fait, en croyant la façade inimportable depuis ses tests. Deux déclarations
du même contrat dérivent, et la dérive est silencieuse. TIW-13 a finalement retenu
mieux : un **rétrécissement** structurel — `{ code, path }`, la surface exacte que
le dessin consomme — vérifié au site d'appel. Ce n'est pas une seconde
déclaration mais un sous-type : il ne peut pas prétendre à un champ que la façade
ne fournit pas.

## Ce que cette frontière ne peut pas garantir

Trois choses, toutes mesurées dans ce ticket, et aucune des trois ne se lit dans
la configuration.

### La position des blocs dans `eslint.config.js` porte du sens

`no-restricted-imports` prend des options, et pour un fichier donné les options du
**dernier bloc qui matche remplacent** les précédentes — elles ne fusionnent pas.
Deux conséquences, dans les deux sens :

- Le bloc de la carte est placé **avant** `travels-in-world/i18n-navigation` et
  `travels-in-world/domain-purity`, pour que ces deux-là gardent le dernier mot
  sur les fichiers qu'ils nomment. Déplacé en fin de tableau,
  `npm run test:lint` rend **25 échecs sur 160** — dont ceux de la pureté du
  domaine et celui qui garde la liberté de `src/i18n/navigation.ts`. La position
  est un invariant testé, pas une convention.
- Réciproquement, le bloc de la carte **étale** `NAVIGATION_RESTRICTED_PATTERNS`,
  parce que ses options remplacent celles du bloc de base pour tous les fichiers
  qu'il matche, `src/app/**` compris. Sans cet étalement, l'invariant 2
  d'`AGENTS.md` est supprimé pour tout `src/**`, lint vert et aucun diff pour le
  montrer.

**Le résiduel assumé.** Un bloc ajouté plus tard, dont les `patterns` sont écrits
en ligne au lieu d'être étalés depuis les constantes nommées, recrée exactement ce
trou pour les fichiers qu'il matche. La forme qui l'éliminerait pour de bon est
une partition de `src/**` en ensembles de fichiers **disjoints**, chacun portant
un `no-restricted-imports` complet : aucun fichier ne serait plus matché deux
fois, et la question de l'ordre ne se poserait plus. Écartée dans ce ticket parce
que `eslint.config.js` est modifié par trois branches simultanément, et qu'une
restructuration du tableau entier est le pire diff possible dans cette situation.
Notée comme dette.

### Tout bloc de restauration doit restater _toutes_ les règles à options

C'est la leçon la plus transférable de ce ticket, et elle a mis trois occurrences
à se formuler correctement. La première tentative disait « attention à l'ordre des
blocs ». La deuxième, « le dernier bloc qui matche un fichier doit contenir tout
ce qui doit s'y appliquer ». Les deux sont vraies et les deux sont trop étroites,
parce qu'elles ne parlent que de `no-restricted-imports`.

La formulation qui couvre les trois cas mesurés :

1. Le bloc de la carte est large sur `src/**`. Sans étaler
   `NAVIGATION_RESTRICTED_PATTERNS`, il supprime l'invariant 2 partout où il
   matche — c'est pourquoi il l'étale.
2. Un bloc d'exemption écrit en `"off"` n'exempte pas ce qu'il vise, il éteint
   tout : `src/i18n/navigation.ts` pouvait atteindre `@/map/dataset`.
3. Un bloc de restauration qui restate `no-restricted-imports` mais oublie
   `no-restricted-syntax` fait disparaître de son dossier le ban d'import
   dynamique — une **autre règle**, que la formulation précédente ne couvrait pas.
   Le même oubli, appliqué à `src/domain/**`, y rendait `await import("node:fs")`
   acceptable alors que l'invariant le plus ancien du dépôt l'interdit.

Les trois ont la même signature, et c'est elle qu'il faut reconnaître : **le
remède existait dans le fichier, et le dossier qui en avait le plus besoin en
était exempté.** Une fois par `ignores`, une fois par `"off"`, une fois par une
règle qui ne voyait pas la bonne forme syntaxique.

Corollaire opératoire, à vérifier par la mesure et non par la lecture : pour
chaque dossier de `src/` — `app`, `content`, `domain`, `i18n`, `map`, `styles` —
quel est le dernier bloc qui le matche, et porte-t-il **toutes** les règles à
options qui doivent s'y appliquer ? Trois cases de ce tableau ont surpris leurs
propres auteurs dans ce ticket.

Et un second corollaire, plus contre-intuitif : **un invariant qui survit par
omission a plus besoin d'un test qu'un invariant énoncé.** `src/i18n/navigation.ts`
est couvert par le sélecteur de la carte non parce qu'un bloc le dit, mais parce
que le bloc qui le matche en dernier ne mentionne pas `no-restricted-syntax` — ses
options survivent donc par défaut. Rien dans la configuration ne signale cette
dépendance, et un lecteur qui ajoute une seule ligne à ce bloc la détruit sans
rien lire de contradictoire. Le scénario a été simulé : poser un
`no-restricted-syntax` quelconque dans le bloc de navigation, sans y étaler celui
de la carte, rend **13 échecs sur 160**. C'est la seule chose qui transforme cette
omission en fait vérifiable.

### Une désactivation totale de la règle annule la frontière, présente et future

`src/i18n/navigation.ts` portait `"no-restricted-imports": "off"`, pour une raison
légitime : c'est le seul fichier autorisé à atteindre les primitives Next brutes.
Mais `"off"` n'est pas « un surensemble de ce que le bloc de la carte interdit »,
c'est **rien**. Ce ticket a remplacé cette désactivation par la règle active
portant les motifs de la carte moins ceux de la navigation. Mesuré avant
correction :
`import { loadWorldDataset } from "../map/dataset"` depuis ce fichier passait
lint, typecheck **et** build.

Et c'est le pire fichier possible pour ça, parce que c'est le module que _tout_
composant client importe — il exporte `usePathname` et `useRouter`. Un import
profond à cet endroit expédie `fs`, `d3-geo` et le jeu de géométries dans le
bundle client sans jamais croiser le guard.

La leçon vaut pour la prochaine exemption : une exemption écrite en `"off"` sur la
règle entière emporte tous les interdits établis avant elle et tous ceux qu'on
ajoutera après. Une exemption s'écrit en options — celles du bloc, moins la seule
chose exemptée.

### La règle ne couvre pas les paquets que le dossier encapsule

Mesuré : `import atlas from "world-atlas/countries-110m.json"` depuis un composant
`'use client'` passait lint et build, et expédiait 105 Ko de TopoJSON au
navigateur. `resolveJsonModule` est actif, donc l'import compile ; aucun module de
la carte n'est en cause, donc la règle de la carte ne regarde même pas. Idem pour
`d3-geo` importé directement.

Une façade ne garde que ses propres modules. Ce que le dossier encapsule doit être
interdit nommément, et c'est pourquoi la règle liste maintenant `world-atlas`,
`d3-*` et `topojson-*` à côté de `@/map/*`. Cette liste est à tenir : toute
bibliothèque ajoutée à `src/map/**` s'y ajoute aussi, sinon la frontière se rouvre
d'un `npm install`.

### L'angle mort de `no-restricted-imports` — comblé, mais pas entièrement

`await import("@/map/world")` est une expression d'appel, pas une déclaration
d'import : **aucune option de `no-restricted-imports` ne la voit**, et ça reste
vrai. Cette section affirmait qu'il fallait s'en accommoder, au même titre que pour
`next/link` (invariant 2) et `node:fs` dans le domaine (ADR 0001). C'était faux :
ce n'est pas la règle ESLint qui manquait, c'est la bonne règle.

Mesuré contre la config réelle (`new ESLint({ cwd })`, sans `overrideConfig`),
depuis `src/app/[locale]/page.tsx`, `src/components/map/world-map.tsx` **et**
`src/i18n/navigation.ts` — verdicts identiques sur les trois :

```
await import("@/map/world")                        -> ALLOWED
await import("../map/dataset")                     -> ALLOWED
await import("world-atlas/countries-110m.json")    -> ALLOWED
await import("d3-geo")                             -> ALLOWED
import { buildWorldGeometry } from "@/map/world";  -> REFUSED   <- témoin
```

Le témoin est ce qui donne leur sens aux quatre premières lignes : le bloc était
bien actif sur ce fichier, il refusait la déclaration, et il laissait passer toutes
les orthographes dynamiques du même module. Un composant `'use client'` expédiait
donc `d3-geo` et 105 Ko de TopoJSON au navigateur sans jamais croiser
`import "server-only"`, avec lint **et** build verts, pour quatre caractères de
plus. C'est le critère 1 mis en échec en silence.

`no-restricted-syntax`, lui, lit l'AST et atteint le nœud `ImportExpression` :
`travels-in-world/map-entry-point` porte maintenant les deux règles côte à côte.
Après correction, les quatre `ALLOWED` sont `REFUSED` sur les trois fichiers, le
témoin reste `REFUSED`.

**Les deux règles sont nécessaires et aucune ne remplace l'autre** :
`no-restricted-syntax` est aveugle à `import x from "@/map/world"` — il n'y a pas
de nœud `ImportExpression` à matcher — et `no-restricted-imports` est aveugle à la
forme dynamique. Vérifié dans les deux sens sur une copie de la config : retirer le
sélecteur fait rougir 44 cas de `tests/lint/map-entry-point.test.ts` et **aucun**
cas statique ; retirer les motifs de la carte de `no-restricted-imports` en fait
rougir 33 et **aucun** cas dynamique. C'est aussi pourquoi ce test assert sur le
`ruleId` et pas sur un compte de violations : un compte ne dirait pas laquelle des
deux a mordu, et la suppression de l'une resterait verte.

Le sélecteur est une transcription en expression régulière des motifs
`["@/map/*", "**/map/*"]` et `["world-atlas", "d3", "d3-*", "topojson", "topojson-*"]`.
Cette transcription est le vrai risque de l'affaire — une regex qui dérive de son
glob est exactement la panne silencieuse que ce dépôt a déjà payée deux fois — donc
les deux mécanismes ont été comparés spécificateur par spécificateur : **33
orthographes, 0 désaccord**, faux positifs compris (`world-atlas-lite`,
`topojsonesque`, `@/mapper/thing` passent des deux côtés ; `d3-geo-projection` est
refusé des deux côtés).

**Ce qui reste hors de portée, et qu'il ne faut pas sous-estimer non plus.** Un
sélecteur syntaxique teste une chaîne littérale. `await import(someVariable)`, un
gabarit `` `@/map/${name}` `` ou un spécificateur reconstruit à l'exécution
n'exposent aucun littéral à matcher : **aucune règle ESLint de ce dépôt ne les
voit**, et aucune ne le pourra sans analyse de flot de données. L'angle mort n'a
pas disparu, il a rétréci — de « toute forme dynamique » à « la forme dynamique à
spécificateur calculé ». Ce résidu est assumé pour la raison que la version
précédente invoquait à tort pour l'ensemble : rien dans ce dépôt ne construit un
spécificateur vers un module interne, et le motif serait voyant en revue.

La leçon vaut au-delà de la carte. « `no-restricted-imports` ne voit pas les
expressions d'appel » décrit une limite de _cette règle_, pas une limite d'ESLint,
et cette section avait pris l'une pour l'autre pendant tout un ticket. L'invariant 2
(`next/link`) et l'ADR 0001 (`node:fs` dans le domaine) portent aujourd'hui la même
affirmation trop large, et le même remède leur est applicable ; le faire relève de
leurs tickets, pas de celui-ci.

## Conséquences

**Ce qu'on gagne.** Les modules internes restent chargeables par du Node nu :
`tests/map/**` importe `@/map/world` et `@/map/projection` statiquement, sans mock
et sans bundler, et `scripts/**` pourra réutiliser le dossier le jour où une
commande aura besoin d'une projection.

> **Correction (TIW-29).** Cette phrase citait aussi `@/map/iso-3166`. Le module a
> été déplacé en `src/iso-3166.ts` par TIW-29, après mesure des trois voies : la
> table des 249 codes ISO devait servir **aussi** au validateur de contenu, qui
> est un script Node nu, et un export de cette façade ne peut jamais le servir —
> `server-only` échoue à la **résolution**, pas à l'exécution
> (`ERR_MODULE_NOT_FOUND`). Le dossier `src/map/` compte donc quatre modules
> internes et non cinq. L'élargissement est assumé : la table est désormais
> lisible depuis tout `src/**`, alors que `@/map/iso-3166` était refusé depuis une
> page. Le guard n'a qu'un
> endroit où vivre, donc une seule chance de se contredire, et
> `tests/map/server-boundary.test.ts` assert les deux moitiés : la façade le porte,
> et aucun autre module ne le porte.

**Ce qu'on paie**, et il faut le lire en entier :

- **Le seul exécuteur réel de `server-only` est le bundler de `next build`, et
  aucun test du dépôt ne le prouve.** Les tests prouvent trois choses plus
  faibles : que la ligne existe, qu'elle est seule, et que la règle ESLint refuse
  quelque chose. Que le build casse vraiment quand un composant client atteint la
  façade n'est vérifié par rien d'automatique.
- **Une façade que rien n'importe n'est vérifiée par aucun build**, et c'est ainsi
  qu'un lecteur de dataset cassé a traversé une barrière verte dans ce ticket même.
  `src/map/dataset.ts` lisait le TopoJSON par
  `createRequire(import.meta.url).resolve()`. Turbopack remplace `require.resolve`
  par un stub qui rend un identifiant de module **numérique** ;
  `readFileSync(38788)` le prend pour un descripteur de fichier et échoue en
  `EBADF: bad file descriptor`. Sous `--webpack` :
  `Cannot find module 'world-atlas/countries-110m.json'`. Aucun bundler ne
  fonctionnait — et `next build` sortait vert, parce qu'aucun fichier de `src/**`
  n'importait `@/map`. Vitest, lui, passait : Vite laisse `createRequire` intact.
  C'est le mode d'échec de l'invariant 1 déplacé du prérendu vers la façade.
  **Corollaire opératoire : tant qu'une façade n'a pas un consommateur réel dans
  `src/app/**`, la tenir pour non vérifiée.**
- **La position des blocs n'est défendue que par `test:lint`.** `test:lint` et
  `test:build` vivent hors de `npm run test` parce qu'elles exigent une étape
  préalable.

  > **Correction (TIW-27).** Ce point disait « que rien ne déclenche » et « il
  > n'existe aucun fichier de CI dans ce dépôt, sur aucune branche ». TIW-22 a
  > livré `.github/workflows/ci.yml`, qui lance les quatre gardes sur chaque pull
  > request et sur chaque poussée vers `main` et `develop`, et la protection de
  > branche fait de la vérification `Vérifications` un préalable à toute fusion.
  > La garde de cette ADR n'est plus une commande qu'un humain doit taper.

- **`test:lint` linte une liste figée de chemins.** Les fixtures nomment
  `src/app/[locale]/page.tsx`, `src/i18n/request.ts`, `src/content/loader.ts` et
  quelques autres, en dur. Un nouveau dossier top-level — `src/widgets/**`,
  `src/api/**` — n'est couvert par aucun cas : la règle s'y appliquera
  peut-être, et rien ne le vérifiera. Tout nouveau dossier de `src/` s'ajoute à
  ces listes.

## Ce qui invaliderait cette décision

1. **Un troisième dossier serveur.** À deux, le motif se répète honnêtement ; à
   trois, on aura trois façades, trois blocs de configuration et trois suites qui
   disent la même chose, et la partition en ensembles disjoints notée en dette
   plus haut deviendra moins chère que la répétition.
2. **`server-only` devenu résolvable** — publié comme paquet réel, ou exposé par
   Next hors de `dist/compiled`. La justification principale de la façade
   disparaîtrait : on pourrait poser le guard sur chaque module sans rendre le
   dossier intestable, et la façade redeviendrait une simple commodité d'API.
3. **Un composant client qui a réellement besoin d'une valeur du dossier**, et pas
   seulement d'un type. Aujourd'hui la réponse est un Server Component qui calcule
   et passe le résultat en props, plus un `import type` pour le contrat. S'il
   fallait une valeur au runtime côté client, ce ne serait pas une entorse à cette
   ADR : ce serait un artefact généré au build et servi comme donnée, donc une
   autre décision à écrire.
4. **L'arrivée d'une règle qui raisonne sur des chemins résolus**
   (`import/no-restricted-paths` et sa notion de zones, déjà pesée dans l'ADR
   0001). Elle rendrait sans objet la moitié des mesures de ce document, au même
   prix : une dépendance à peser contre le budget d'`AGENTS.md`.

Aucun de ces signaux n'est présent aujourd'hui.
