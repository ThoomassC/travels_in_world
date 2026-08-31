# 10. Les frontières d'import se composent par répétition volontaire

- **Statut** : accepté
- **Date** : 2026-08-31
- **Contexte du ticket** : décision prise à la fusion de TIW-11 dans `develop`
  (commit `1225b92`), consignée rétrospectivement par TIW-27
- **Complète** : `docs/adr/0002-facade-serveur-gardee.md`, qui établit la
  sémantique « le dernier bloc qui matche remplace » ; celle-ci consigne ce que
  la rencontre de deux frontières en a fait

## Contexte

Deux frontières d'import ont été conçues séparément, dans deux tickets qui ne se
voyaient pas : la **façade de carte** (TIW-12/13, `@/map` seule porte vers
`src/map/**`) et la **façade de contenu** (TIW-11, `@/content/trips` seule porte
vers `src/content/**`). Elles se sont rencontrées dans `eslint.config.js`, à la
fusion.

Or `no-restricted-imports` et `no-restricted-syntax` prennent des **options**, et
ESLint les résout par « la dernière configuration qui matche gagne », **en
remplaçant** les options des blocs antérieurs au lieu de les fusionner. Deux
conséquences, et c'est la seconde qui fait le piège :

- un bloc tardif posant `no-restricted-imports` sur un ensemble de fichiers
  **supprime** de ces fichiers tous les interdits établis avant lui ;
- « le dernier qui matche gagne » ne retire une règle que si le bloc tardif
  **mentionne cette règle**. Un bloc qui ne dit rien de
  `no-restricted-syntax` laisse donc survivre celui d'un bloc antérieur — par
  héritage, c'est-à-dire par omission.

La panne qui en résulte a la signature que ce dépôt a déjà payée deux fois :
`npm run lint` reste **vert**, le diff ne montre rien de contradictoire, et un
invariant a disparu. Un `next/link` nu perd le segment de locale, et le visiteur
reçoit un 404.

## Décision

**Six blocs, dans un ordre qui porte du sens, et chacun répète volontairement les
motifs des autres.** Ordre réel du tableau exporté :

| #   | ligne | nom                                | cible                                           | règles           |
| --- | ----- | ---------------------------------- | ----------------------------------------------- | ---------------- |
| 1   | 494   | `travels-in-world/rules`           | `**/*.{ts,tsx}`                                 | imports          |
| 2   | 605   | `travels-in-world/map-entry-point` | `src/**` hors `src/map/**`                      | imports + syntax |
| 3   | 752   | `travels-in-world/content-facade`  | `src/**` hors `src/content/**`, `src/domain/**` | imports + syntax |
| 4   | 838   | `travels-in-world/map-internals`   | `src/map/**`                                    | imports + syntax |
| 5   | 891   | `travels-in-world/i18n-navigation` | `src/i18n/navigation.ts`                        | imports seuls    |
| 6   | 917   | `travels-in-world/domain-purity`   | `src/domain/**`                                 | imports + syntax |

Les motifs sont extraits en constantes nommées —
`NAVIGATION_RESTRICTED_PATTERNS`, `MAP_BOUNDARY_PATTERNS`,
`MAP_DYNAMIC_IMPORT_RESTRICTIONS`, `CONTENT_FACADE_RESTRICTED_PATTERNS`,
`CONTENT_FACADE_DYNAMIC_IMPORT_RESTRICTIONS` — précisément pour qu'un bloc
tardif puisse les **répéter**. Ce n'est pas du rangement : c'est le seul moyen de
les conserver.

La règle opératoire, que le fichier réénonce à cinq endroits : **le dernier bloc
qui matche un fichier doit porter tout ce qui doit s'y appliquer.**

### Neuf sites de répétition, et un bloc qui n'est pas une répétition

- `map-entry-point` répète la **navigation** (elle appartient à `rules`).
- `content-facade` répète la **navigation** et **les deux moitiés** de la
  frontière de carte, statique et dynamique — sinon la façade de carte disparaît
  de tout `src/**` hors `src/map/**`.
- `map-internals` répète la **navigation** et **la façade de contenu**, statique
  et dynamique.
- `i18n-navigation` répète la **frontière de carte** et **la façade de contenu**,
  tout en levant la seule interdiction de navigation — c'est sa raison d'être.
- `domain-purity` ne répète **rien**, et c'est légitime : sa propre liste
  interdit tout `next/**`, un surensemble strict des trois motifs de navigation
  pour ce dossier.

**`map-internals` est le seul bloc de ce fichier qui n'existe que parce que deux
frontières dessinées indépendamment se recouvrent.** `map-entry-point` exempte
`src/map/**` — c'est le dossier où `d3-geo`, `topojson-client` et `world-atlas`
sont chez eux. `content-facade`, plus tardif, ne l'exempte pas (à raison : un
module de carte n'a pas plus à lire le disque qu'une page), et ses deux `spread`
de carte retombaient donc **à l'intérieur** de `src/map/**`, annulant l'exemption.
Mesuré, ce n'est pas une sur-portée théorique :

```
src/map/dataset.ts    import { geoPath } from "d3-geo";                  -> REFUSED
src/map/dataset.ts    import { feature } from "topojson-client";         -> REFUSED
src/map/dataset.ts    import RAW from "world-atlas/countries-110m.json"; -> REFUSED
src/map/projection.ts import { geoNaturalEarth1 } from "d3-geo";         -> REFUSED
src/map/world.ts      import { NUMERIC_BY_ALPHA2 } from "@/map/iso-3166";-> REFUSED
```

— quatre fichiers réels faisant échouer `npm run lint`, pour une frontière qui
n'a jamais été censée pointer vers l'intérieur. Ce bloc **ne porte aucun motif de
carte**, et c'est ce qui en fait l'exemption plutôt qu'une copie du bloc
précédent.

## Chaque répétition est prouvée par échec volontaire

Sept mutations, une répétition retirée à la fois, mesurées sur `develop`
(2306e9a) puis restaurées. Baseline : `npm run test:lint` **289 verts**,
`npm run lint` vert.

| mutation                                                         | `test:lint` | `lint`    |
| ---------------------------------------------------------------- | ----------- | --------- |
| `content-facade` perd `MAP_DYNAMIC_IMPORT_RESTRICTIONS`          | 44 rouges   | vert      |
| `content-facade` perd `MAP_BOUNDARY_PATTERNS`                    | 25 rouges   | vert      |
| `content-facade` perd `NAVIGATION_RESTRICTED_PATTERNS`           | 12 rouges   | vert      |
| `map-internals` perd la façade de contenu (statique + dynamique) | 21 rouges   | vert      |
| `i18n-navigation` perd `MAP_BOUNDARY_PATTERNS`                   | 7 rouges    | vert      |
| `i18n-navigation` perd la façade de contenu                      | 1 rouge     | vert      |
| bloc `map-internals` neutralisé                                  | 12 rouges   | **rouge** |

La dernière ligne corrige une imprécision d'`AGENTS.md`, qui écrit que supprimer
l'une de ces répétitions « fait rougir `npm run test:lint`, et rien d'autre ».
C'est vrai des répétitions ; ce n'est pas vrai de `map-internals`, qui est une
**exemption** et non une répétition : sa disparition casse aussi `npm run lint`
sur quatre fichiers réels, exactement comme son commentaire l'annonce.

Et pour mémoire, la position elle-même reste gardée : déplacer `map-entry-point`
en fin de tableau rend **84 cas rouges sur 289** — 38 dans la suite de la pureté
du domaine, 40 dans celle de la façade de contenu, et seulement **6** dans la
sienne.

## Ce que la rédaction de cette ADR a trouvé, et qui n'était gardé par rien

Une huitième mutation ne rougit pas, et c'est le résultat le plus important de ce
document.

**`map-entry-point` privé de `NAVIGATION_RESTRICTED_PATTERNS` :
`npm run test:lint` reste à 289 verts, `npm run lint` reste vert.** Et la
protection est bel et bien perdue. Sonde à l'API Node d'ESLint, même
configuration, même `cwd`, sur `import Link from "next/link"` :

| fichier                            | baseline | mutation    |
| ---------------------------------- | -------- | ----------- |
| `src/content/loader.ts`            | REFUSED  | **ALLOWED** |
| `src/content/validate.ts`          | REFUSED  | **ALLOWED** |
| `src/app/[locale]/page.tsx`        | REFUSED  | REFUSED     |
| `src/components/map/world-map.tsx` | REFUSED  | REFUSED     |

La cause est structurelle et se lit dans le tableau des blocs :
`map-entry-point` est le **dernier** bloc à mentionner `no-restricted-imports`
pour les fichiers non-spec de `src/content/**`, parce que `content-facade` — le
seul bloc plus tardif qui couvre `src/**` — porte `src/content/**` dans ses
`ignores`. Cette répétition-là est donc la seule chose qui applique l'invariant 2
à `src/content/**`.

Et aucun cas des trois suites ne linte un fichier de `src/content/**` contre
`next/link` : les cas de navigation de `content-facade.test.ts` et de
`map-entry-point.test.ts` visent `src/app/[locale]/page.tsx`, un module de carte
et `src/i18n/navigation.ts`. La répétition est **écrite mais non épinglée**.

C'est mot pour mot la forme que ce dépôt a nommée à TIW-13 : « un invariant qui
survit par omission a plus besoin d'un test qu'un invariant énoncé ». Ici il ne
survit même pas par omission — il est écrit noir sur blanc, et rien ne verrait sa
disparition. Le remède est un cas de plus dans l'une des deux suites, sur un
fichier de `src/content/**` ; il appartient à un ticket de code, pas à celui-ci.

Deux répétitions de plus ne tiennent qu'à **un seul cas** chacune —
`i18n-navigation` face à la façade de contenu, et la moitié dynamique de
`map-internals`. Le filet existe, il est d'un seul fil.

### Un piège de plus, que le fichier ne documente pas

La doctrine « les options du dernier bloc remplacent celles des précédents » ne
vaut **que si le bloc tardif fournit des options**. Mesuré : réduire le
`no-restricted-syntax` de `map-internals` à la sévérité seule — `["error"]` — ne
neutralise rien, les options de `content-facade` sont **héritées**, et les quatre
mêmes faux positifs reviennent refuser `d3-geo` dynamiquement dans `src/map/**`.
Quelqu'un qui écrirait `["error"]` en croyant éteindre le bloc précédent
obtiendrait l'inverse de son intention.

## Alternatives écartées

**Partitionner `src/**` en ensembles de fichiers disjoints**, chacun portant un
`no-restricted-imports` complet. Aucun fichier ne serait plus matché deux fois et
la question de l'ordre disparaîtrait. C'est la forme qui éliminerait ce document.
Notée comme dette par l'ADR 0002 et écartée pour la même raison qu'alors,
renforcée depuis : `eslint.config.js` est modifié par plusieurs branches
simultanément, et une restructuration du tableau entier est le pire diff possible
dans cette situation. À reprendre quand les branches se seront tues.

**Exempter par `ignores` au lieu d'un bloc dédié.** `ignores` est **par bloc**,
pas par règle : exempter un fichier d'une famille de motifs l'exempte de tout ce
que le bloc porte. Mesuré à TIW-11 : `src/i18n/navigation.ts` — le module que
_tout_ composant client importe — pouvait ainsi atteindre `@/content/loader` et
`@/map/world`, lint, typecheck et build verts.

**Exempter par `"off"` sur la règle entière.** Pire encore : `"off"` n'est pas
« un surensemble de ce qui est interdit », c'est **rien**, et il emporte les
interdits futurs autant que les présents. C'est l'orthographe d'origine de
l'exemption de `src/i18n/navigation.ts`, et elle a produit les trois acceptations
ci-dessus. Une exemption s'écrit en options : celles du bloc, moins la seule
chose exemptée.

**Une règle qui raisonne sur des chemins résolus** —
`import/no-restricted-paths` et sa notion de zones. Elle rendrait sans objet la
moitié de ce document et de l'ADR 0002, au prix d'une dépendance à peser contre
le budget de l'ADR 0009. Toujours pas franchi.

## Ce qu'on paie

**Neuf répétitions à tenir à jour, et rien qui les recense.** Chaque bloc porte
un long commentaire, excellent et local ; la vue d'ensemble n'existait nulle part
avant ce document. C'est précisément pourquoi il est écrit.

**Un bloc ajouté plus tard recrée le trou.** Un septième bloc dont les
`patterns` seraient écrits en ligne au lieu d'être étalés depuis les constantes
nommées supprime, pour les fichiers qu'il matche, tout ce que les blocs
antérieurs y appliquaient. Le fichier l'annonce à trois endroits ; il n'existe
aucun mécanisme pour l'empêcher.

**Les chiffres des commentaires ont vieilli.** Le commentaire du bloc
`map-entry-point` annonce que le déplacer « turns 28 of its 75 cases red ». La
suite en compte 132, le déplacement en rougit 84 au total, et **6 seulement sont
les siens**. Le fait tient, le chiffre et l'attribution non. Même remarque pour
les 44/33, les « 21 de 155 » et les « 13 de 160 » cités par les messages de
commit et par l'ADR 0002 : tous sont des états antérieurs d'une suite qui compte
aujourd'hui 289 cas.

**`test:lint` linte une liste figée de chemins.** Les fixtures nomment des
fichiers en dur. Un nouveau dossier top-level de `src/` n'est couvert par aucun
cas : la règle s'y appliquera peut-être, et rien ne le vérifiera. Tout nouveau
dossier de `src/` s'ajoute à ces listes — et la mutation non gardée ci-dessus est
la démonstration que cette phrase n'est pas une précaution de style.

## Ce qui invaliderait cette décision

1. **Un troisième dossier serveur**, donc une troisième façade. À deux, la
   répétition se tient ; à trois, le nombre de sites passerait de neuf à une
   quinzaine, et la partition en ensembles disjoints deviendrait moins chère que
   la répétition. C'est déjà le signal n° 1 de l'ADR 0002 ; ce document en
   double la force, parce qu'il chiffre le coût de la composition.
2. **Une règle raisonnant sur des chemins résolus**, entrée dans le budget de
   dépendances. Elle supprimerait la sémantique de remplacement de l'équation.
3. **Le fichier cessant d'être modifié par plusieurs branches à la fois.** C'est
   la seule raison pour laquelle la partition disjointe a été refusée. Cette
   raison est conjoncturelle, et elle finira.
