# 11. La table ISO 3166-1 vit à la racine de `src/`, hors de toute façade

- **Statut** : accepté
- **Date** : 2026-09-01
- **Contexte du ticket** : TIW-29 (le validateur de contenu doit refuser un code
  pays qu'aucune carte ne sait dessiner), consignée par TIW-32
- **Complète** : `docs/adr/0002-facade-serveur-gardee.md`, qui porte déjà la note
  de correction correspondante ; celle-ci écrit la décision en entier

## Contexte

`src/iso-3166.ts` transcrit les 249 codes ISO 3166-1 alpha-2 officiellement
attribués, chacun avec son code numérique. La table existe parce que rien
d'autre ne joint les deux clés du projet : `world-atlas` indexe ses géométries
sur le **numérique**, le contenu indexe ses lieux sur l'**alpha-2**, et le
`properties.name` du dataset est un libellé d'affichage Natural Earth —
`"N. Cyprus"`, `"Dem. Rep. Congo"`, `"Bosnia and Herz."` — abrégé pour une
légende de carte et normalisé contre aucun registre. Joindre là-dessus est un
bug qui attend le premier libellé accentué ou abrégé, et le critère 2 de TIW-12
l'interdit d'emblée.

Elle a vécu en `src/map/iso-3166.ts`, derrière la façade `@/map` et son
`import "server-only"`, aussi longtemps qu'elle n'a eu qu'un consommateur : la
jointure de la carte.

TIW-29 lui en donne un second, dans une couche qui ne peut pas l'atteindre.
`npm run validate:content` blanchissait un voyage que `next build` refusait
ensuite. Mesuré sur un voyage déclarant `XK` — le code que tout le monde écrit
pour le Kosovo, et que l'ISO 3166-1 n'attribue à personne :

```
$ TIW_CONTENT_DIR=… npm run validate:content
1 voyage validé dans …, aucun problème.                            (code 0)

$ TIW_CONTENT_DIR=… npm run build
Error occurred prerendering page "/fr".
Error: le code pays « XK » n'est pas un code ISO 3166-1 alpha-2 … puis relance
« npm run validate:content ».                                      (code 1)
```

Boucle fermée : le build renvoyait l'auteur vers l'outil qui venait de blanchir
son fichier. Pour la rompre, le validateur doit connaître la liste — et le
validateur est un script Node nu,
`node --import ./scripts/runtime/register-typescript.mts scripts/validate-content.ts`.

## Décision

**La table est `src/iso-3166.ts`, à la racine de `src/`, derrière aucune
façade.** Trois voies ont été mesurées avant le déplacement, pas argumentées.

**1. L'exposer par la façade `@/map` est une voie morte.** Mesuré, sur un script
important `@/map` sous `node --import ./scripts/runtime/register-typescript.mts` :

```
ERR_MODULE_NOT_FOUND: Cannot find package 'server-only'
```

C'est le fait qui porte cette ADR, et il est plus large que la table.
`server-only` n'est pas un paquet de ce dépôt : il vit dans
`node_modules/next/dist/compiled/server-only`, où seul le bundler de Next
l'alias (ADR 0002). L'échec est donc à la **résolution**, pas à l'exécution — et
un échec de résolution ne dépend pas de ce qu'on importe du module. **Aucun
export d'une façade gardée ne peut jamais servir un script Node.** Ce n'est pas
une propriété de cette table, c'est une propriété de la façade, et elle vaudra
identiquement pour `@/content/trips`, gardée de la même manière, le jour où un
script voudra une de ses valeurs.

**2. L'importer en profondeur, `@/map/iso-3166`, est refusé par conception.**
Mesuré avec ESLint sur `src/content/validate.ts` :
`'@/map/iso-3166' import is restricted from being used by a pattern`, règle
`travels-in-world/map-entry-point`. Élargir cette règle pour le validateur
ouvrirait la même porte à tout `src/**`, composants `'use client'` compris —
c'est-à-dire exactement le trou que l'ADR 0002 a passé un ticket à refermer.

**3. La dupliquer marche, et coûte une troisième transcription.** Le motif « une
seconde copie plus un test qui tient les deux en phase » n'est pas théorique
ici : le dépôt le fait déjà tourner entre cette table et
`src/domain/continent.ts`, qui range les mêmes codes par région M49. Une copie
de plus serait la **troisième** transcription de 249 lignes à maintenir en
phase, quand un module partagé coûte un fichier.

D'où le déplacement à la racine de `src/`, la table gardant chacune de ses
lignes et gagnant le prédicat `isAssignedCountryCode` dont le validateur a
besoin.

### L'élargissement est réel, et il est assumé

Il faut l'écrire, parce que sortir un module d'une façade est mécaniquement un
affaiblissement.

**Ce qui n'a pas bougé.** `src/domain/**` ne peut toujours pas atteindre la
table : la règle `travels-in-world/domain-purity` interdit **tout** `@/*` depuis
le domaine, mesuré. Le refus de `CountryCodeSchema` de connaître la liste et
l'ADR 0001 sont donc intacts. Le domaine valide la _forme_ d'un code,
`src/iso-3166.ts` sait quels codes existent, et refuser du contenu appartient à
`src/content`.

**Ce qui a bougé.** Tout autre module de `src/**` peut désormais l'importer, là
où `@/map/iso-3166` était refusé depuis une page. C'est accepté, et la raison
tient en une phrase : ce que protège le critère 2 de TIW-12, c'est que personne
ne refasse la **jointure** — et la jointure a besoin de la géométrie, qui ne
quitte ni `src/map`, ni la façade, ni `server-only`, ni l'interdiction ESLint de
`world-atlas`, `d3-*` et `topojson-*`. Ces numériques seuls ne dessinent rien.

**Ce que ça pèse.** Le littéral de la table fait **3 277 octets** bruts, mesuré
sur le fichier tel qu'il est écrit. Le plafond de 150 Ko brotli de
`npm run test:build` n'est pas en jeu, même dans le pire cas où elle partirait
entière au navigateur.

**Ce que ça change dans `src/map`.** Le dossier compte maintenant **quatre**
modules internes — `dataset.ts`, `path-context.ts`, `projection.ts`, `world.ts`
— plus la façade `index.ts`, seule à porter le guard.

### Les gardes

- `tests/map/server-boundary.test.ts` : la façade porte `import "server-only"`,
  et **aucun autre** module du dossier ne le porte. Un déplacement qui aurait
  laissé un guard orphelin fait rougir cette seconde moitié.
- `tests/lint/domain-purity.test.ts` : la règle refuse réellement `@/*` depuis
  le domaine. C'est ce qui rend vérifiable la phrase « rien n'a été affaibli »
  plutôt que rassurante.
- `tests/iso-3166.test.ts` : le contrat propre du module.
- `tests/map/iso-3166.test.ts` : la jointure avec le dataset reste du côté de la
  carte, où elle appartient.
- `tests/domain/continent.test.ts` : compare la table des continents aux 249
  codes, dans les deux sens, et rougit le jour où l'une des deux bouge sans
  l'autre.

Deux contrôles de justesse ont par ailleurs été passés sur la table telle
qu'écrite, et sont bon marché à rejouer quand un code est ajouté : chacun des
**174** identifiants numériques de `countries-110m.json` est atteint par
exactement un alpha-2 (177 géométries moins les 3 qui ne portent aucun
identifiant — Chypre du Nord, le Somaliland, le Kosovo) ; et
`new Intl.DisplayNames(["en"], { type: "region" }).of(alpha2)` rend un nom, et
non le code lui-même, pour les 249 clés — ICU renvoyant son entrée telle quelle
sur un code qu'il ne connaît pas, c'est ainsi qu'un alpha-2 mal tapé se voit.

## Alternatives écartées

**Exposer la table par `@/map`.** Mesurée : `ERR_MODULE_NOT_FOUND`. Voie morte,
et pas seulement pour cette table.

**Élargir `travels-in-world/map-entry-point` pour le validateur.** Mesurée
refusée en l'état. Même bien écrite — en options et non en désactivation, ce que
l'ADR 0002 a appris à ses dépens — cette exemption donnerait au validateur un
droit d'accès profond que le reste de `src/**` n'a pas, sur le dossier dont la
façade est la seule chose qui tienne le budget de la carte.

**Une seconde copie tenue en phase par un test.** Marche. Écartée pour son coût
et non pour un risque : une troisième transcription de 249 lignes.

**Poser la table dans `src/domain`.** Écartée par un argument écrit dans le
dépôt plutôt que par une mesure, et il faut le dire ainsi. `src/domain/geo.ts`
refuse à `CountryCodeSchema` de vérifier qu'un code _existe_, au motif qu'un
registre dans le domaine « mettrait une copie de la liste ISO dans le domaine et
la daterait » ; `src/domain/continent.ts` explique à l'inverse pourquoi sa
propre table y a sa place — elle ne refuse rien, `continentOf` est totale, un
code inconnu répond `null`. Cette table-ci est exactement le cas symétrique :
elle est ce qui **refuse** du contenu.

**Un dossier `src/iso-3166/` plutôt qu'un fichier.** Non pesé, et signalé comme
tel : un module sans dépendance, avec une table, une carte inverse et un
prédicat, n'a rien à gagner à devenir un dossier tant qu'il n'a pas de second
fichier à y mettre.

## Ce qu'on paie

**`src/` a maintenant un fichier à sa racine, et c'est le premier.** À côté de
`app`, `components`, `content`, `domain`, `i18n`, `map` et `styles`, il y a
`iso-3166.ts`. À un fichier c'est une exception lisible ; c'est aussi une
convention que personne n'a écrite, et le prochain module « transverse » ira
naturellement s'y poser sans que rien ne le lui refuse.

**Rien n'interdit à un composant `'use client'` d'importer la table.** Aucun ne
le fait aujourd'hui — vérifié : ses seuls consommateurs de production sont
`src/content/validate.ts`, `src/map/dataset.ts` et `src/map/world.ts`. Mais
c'est bien la porte que l'élargissement ouvre, et il faut la nommer : 3,3 Ko
bruts partiraient dans un bundle client sans qu'aucune règle ne morde, et le
budget de 150 Ko de l'ADR 0009 ne les verrait pas non plus — c'est un budget,
il attrape ce qui est gros. Résidu assumé, écrit ici plutôt que découvert plus
tard.

**Deux transcriptions des 249 codes subsistent** — `src/iso-3166.ts` et
`src/domain/continent.ts` — tenues en phase par un test et non par le typage. Le
déplacement a évité la troisième ; il n'a pas supprimé la seconde, et ne le
pouvait pas : `continent.ts` porte en plus `XK`, que l'autre table ne peut pas
porter.

**`tests/lint/map-entry-point.test.ts` décrit encore une frontière autour d'un
chemin qui n'existe plus.** Ses cas nomment `@/map/iso-3166` et `"./iso-3166"`
en dur. Ils passent, parce qu'ils portent sur des motifs de chemin et non sur
l'existence du fichier — mais ils testent désormais la règle contre une
orthographe que plus personne ne peut écrire.

## Ce qui invaliderait cette décision

1. **`server-only` devenu résolvable** — publié comme paquet réel, ou exposé par
   Next hors de `dist/compiled`. La voie morte cesserait d'en être une : la
   table pourrait revenir derrière la façade sans rendre le dossier intestable,
   et la question redeviendrait une question de rangement. C'est le même signal
   que le second de l'ADR 0002, et il les invalide toutes les deux ensemble.
2. **Un consommateur qui aurait besoin de la géométrie et pas seulement des
   numériques.** Ce serait la jointure refaite hors de `src/map`, donc le
   critère 2 de TIW-12 qui tombe, et pas cette ADR. La réponse serait un export
   de la façade, pas un second module à la racine.
3. **Un composant client qui importe réellement la table.** La question
   deviendrait « est-ce une donnée servie au build plutôt qu'un module ? », et
   la réponse ne serait plus un emplacement de fichier.
4. **Un troisième fichier à la racine de `src/`.** À un fichier, c'est une
   exception ; à trois, c'est un dossier qu'on n'a pas nommé, et il faudra
   décider ce qu'il garde et ce qui a le droit de l'atteindre.
