# 15. Un artefact généré est la façon dont une couche non gardée interroge une couche gardée

- **Statut** : accepté
- **Date** : 2026-09-01
- **Contexte du ticket** : TIW-30 (refuser un pays que le fond de carte ne sait
  pas dessiner), consignée rétrospectivement par TIW-33
- **Complète** : `docs/adr/0002-facade-serveur-gardee.md`, dont c'est le
  troisième signal d'invalidation qui s'est réalisé, et
  `docs/adr/0011-la-table-iso-hors-des-facades.md`, dont c'est la question
  posée une couche plus loin

## Contexte

`npm run validate:content` doit refuser un lieu dont le `countryCode` est
parfaitement valide et parfaitement indessinable. Trois crans, trois questions
distinctes, chacune dans la couche qui peut y répondre :

| cran     | posé par                 | échoue sur | ticket |
| -------- | ------------------------ | ---------- | ------ |
| forme    | `CountryCodeSchema`      | `jp`       | TIW-9  |
| attribué | `isAssignedCountryCode`  | `XK`       | TIW-29 |
| dessiné  | `DRAWABLE_COUNTRY_CODES` | `SG`       | TIW-30 |

Le troisième cran n'est pas un raffinement du second : **75 des 249 codes ISO
attribués n'ont aucune forme** au millésime livré, Singapour et Hong Kong
compris. Sans lui, `validate:content` blanchissait un voyage que
`buildWorldGeometry` faisait ensuite exploser au milieu du prérendu de `/fr` —
la même boucle fermée que TIW-29 avait payée sur `XK`, l'outil de validation
étant celui que le message d'erreur du build recommandait de relancer.

**Et la couche qui doit répondre ne peut pas atteindre la donnée qui sait.** Les
deux voies directes sont fermées, chacune pour une bonne raison :

- `import atlas from "world-atlas/countries-110m.json"` depuis
  `src/content/validate.ts` est refusé par `travels-in-world/map-entry-point`,
  qui bannit `world-atlas`, `d3-*` et `topojson-*` de tout `src/**` hors
  `src/map/**`. C'est l'interdiction que l'ADR 0002 a ajoutée après avoir mesuré
  qu'un composant `'use client'` expédiait 105 Ko de TopoJSON au navigateur avec
  un lint et un build verts ;
- passer par la façade `@/map` échoue **à la résolution**, pas à l'exécution :
  `Cannot find package 'server-only'` sous le Node nu du validateur. Mesuré par
  TIW-29, et c'est le fait qui porte l'ADR 0011 : **aucun export d'une façade
  gardée ne peut jamais servir un script Node.**

## La prédiction de l'ADR 0002 s'est réalisée

Le troisième signal d'invalidation de l'ADR 0002 dit ceci, mot pour mot :

> 3. **Un composant client qui a réellement besoin d'une valeur du dossier**, et
>    pas seulement d'un type. Aujourd'hui la réponse est un Server Component qui
>    calcule et passe le résultat en props, plus un `import type` pour le
>    contrat. S'il fallait une valeur au runtime côté client, ce ne serait pas
>    une entorse à cette ADR : ce serait un artefact généré au build et servi
>    comme donnée, donc une autre décision à écrire.

C'est cette décision. Elle mérite d'être consignée pour la raison que la note de
TIW-14 sur l'ADR 0003 donne : une prédiction qui se réalise et qu'une décision
encaisse en apprend plus qu'une décision jamais éprouvée. Et comme là-bas, elle
s'est réalisée **de travers**, ce qui est la moitié intéressante.

**Ce que le signal annonçait de juste.** Un consommateur a réellement eu besoin
d'une **valeur** du dossier gardé, et pas seulement d'un type. Le remède prévu
est exactement celui qui a été retenu : un artefact, servi comme donnée. La
frontière n'a pas bougé d'une ligne — ni exemption ESLint, ni import profond, ni
guard déplacé.

**Ce qu'il annonçait de faux, en deux points.**

Le premier : **ce n'est pas un composant client.** C'est
`src/content/validate.ts`, appelé par un script Node. L'ADR 0002 avait nommé le
seul consommateur qu'elle voyait ne pas pouvoir traverser la frontière — celui
qui est de l'autre côté du bundler — et la frontière en a **deux** côtés
infranchissables : celui du bundler client, et celui de Node nu, où la façade ne
se résout même pas. Le second était déjà connu au moment où l'ADR 0002 a été
écrite ; il n'a simplement pas été reconnu comme le même problème.

Le second, plus opératoire : **l'artefact n'est pas « généré au build ».** Il est
généré par une commande, `npm run basemap:coverage`, et **committé**. La nuance
n'est pas de rangement. Un artefact produit pendant `next build` arriverait trop
tard : le consommateur est `validate:content`, que le hook `prebuild` lance
**avant** tout `npm run build`, précisément pour qu'un contenu fautif n'atteigne
jamais le prérendu. Un artefact généré au build serait un artefact que le
validateur ne peut pas lire — la même impasse chronologique que TIW-29 a
constatée dans l'autre sens.

Le mécanisme réutilisable est donc plus large que ce que la prédiction disait, et
c'est lui qu'il faut retenir : **une couche non gardée n'interroge pas une couche
gardée ; elle lit un texte qu'une commande a extrait de cette couche.**

## Décision

**La réponse est précalculée par une commande et committée comme donnée simple.**

`npm run basemap:coverage` lit les trois millésimes de `world-atlas`, joint leurs
identifiants numériques aux alpha-2 de `src/iso-3166.ts`, et écrit
`src/basemap-coverage.ts` : deux `ReadonlySet<string>`, le millésime, la liste
des millésimes plus fins et le nom de la commande qui régénère le fichier.

Quatre propriétés décident de la valeur du dispositif.

**1. Le validateur lit du texte, pas le dataset.** `src/content/validate.ts`
importe `@/basemap-coverage`, un module de TypeScript pur sans aucune
dépendance. `map-entry-point` n'a rien à voir, `server-only` n'entre pas dans
l'histoire, la frontière de l'ADR 0002 est intacte — et la vérification est
directe : le module est à la racine de `src/`, importable par tout `src/**`,
et ne fait entrer ni `world-atlas`, ni `d3-*`, ni `topojson-*` dans le graphe de
qui que ce soit.

**2. Le script, lui, a le droit de lire le dataset — et il lit autrement que
l'application.** `scripts/generate-basemap-coverage.ts` utilise
`createRequire().resolve()` là où `src/map/dataset.ts` argumente longuement pour
un `import` statique, et les deux ont raison : l'un est compilé par un bundler,
l'autre est du Node nu, où `import atlas from "….json"` sans attribut échoue en
`ERR_IMPORT_ATTRIBUTE_MISSING`. Le script doit en plus ouvrir trois millésimes,
dont deux que l'application ne charge jamais. Ce sont deux lectures différentes
du même fichier, et ce sont les gardes ci-dessous qui les tiennent honnêtes l'une
envers l'autre.

**3. La prose du fichier généré est générée aussi.** Les comptes que porte son
en-tête — « 75 des 249 », « les 174 pays », « les 238 pays », la liste nominative
des onze — sont interpolés par `render()` à partir des mêmes ensembles que les
listes. Un fichier généré dont le commentaire est écrit à la main est un
commentaire qui mentira au premier bump ; ici il ne peut pas diverger de sa
propre donnée. Le fichier passe par Prettier **avant** d'être écrit, pour la même
raison : un reformatage qu'un humain doit penser à faire est un
`npm run lint` rouge qui attend le prochain `world-atlas`.

**4. Chaque chiffre est vérifiable en une commande.** Relevé pour cette ADR :

```
$ npm run basemap:coverage
src/basemap-coverage.ts écrit : 174 pays dessinés par le millésime 110m,
75 codes ISO sans forme, dont 64 qu'un millésime plus fin dessinerait.

$ git diff --stat src/basemap-coverage.ts
(vide)
```

La régénération est **idempotente à l'octet** sur `develop` @ `a9d73bc`, ce qui
est la seule preuve directe que le fichier committé est bien la sortie de la
commande qui prétend l'écrire. Les cinq nombres du dossier, recomptés
indépendamment depuis `@/iso-3166` et `@/basemap-coverage` : **249** codes
attribués, **174** dessinés au 110m, **238** dessinés par un millésime
quelconque, **75** sans forme au 110m, dont **64** qu'un millésime plus fin
dessinerait et **11** qu'aucun ne dessine — `BQ, BV, CC, CX, GF, GP, MQ, RE, SJ,
TK, YT`, les départements et collectivités d'outre-mer français pour l'essentiel.

## La fraîcheur est le vrai problème, et la réponse est deux gardes à deux moments

**Un artefact généré qui ment est pire que pas d'artefact.** Une liste périmée ne
tombe pas en panne : elle refuse du contenu qui se dessine parfaitement, ou elle
blanchit du contenu dont le prérendu mourra. Et elle se périme sans que personne
n'agisse — un `npm install` qui bouge `world-atlas` suffit, et
`npm run basemap:coverage` n'est lancé par aucun hook, aucune étape de CI, aucun
`prebuild`. C'est délibéré : régénérer automatiquement un fichier committé
produirait un diff que personne ne relit, ce qui est exactement l'inverse du but.

D'où deux comparaisons au vrai dataset, à deux moments, aucune ne remplaçant
l'autre :

**`tests/map/basemap-coverage.test.ts` — le signal rapide et précis.** Il
recalcule les deux listes depuis le TopoJSON livré, lu par `tests/map/support.ts`
indépendamment **et** du générateur **et** de `src/map/dataset.ts`, et compare
deux tableaux triés plutôt que deux ensembles, pour qu'un échec imprime _quels_
codes ont bougé plutôt que « 174 attendus, 175 obtenus ». Il tourne à chaque
`npm test`, donc sur chaque pull request. Huit cas au total : les deux
comparaisons de listes, et six propriétés qu'un diff ne donnerait pas — que le
millésime annoncé est celui que la carte importe, que les trois millésimes du
paquet sont tous couverts, que le 110m est un sous-ensemble strict des plus fins
(sinon « change de millésime » serait un mauvais conseil pour un code), que 75
codes attribués restent sans forme et que Singapour en est, que les onze
indessinables sont bien ces onze-là, et que le module porte le nom exact de la
commande qui le régénère — pour qu'un échec soit actionnable sans aller le
chercher.

**`src/map/world.ts` — la comparaison à la géométrie réellement projetée.** Elle
vit là parce que c'est le seul module qui tient les formes que le site est sur le
point de dessiner, et elle tourne **à l'intérieur de `next build`**, c'est-à-dire
dans la seule exécution qui part en ligne. Elle vérifie d'abord que le millésime
décrit est celui qui est importé — deux millésimes peuvent dessiner par hasard
les mêmes pays sans être le même fichier, donc une liste concordante ne prouve
pas que l'artefact vienne de ce qui est importé — puis compare les deux
ensembles. Elle **jette**, elle n'avertit pas : un `console.warn` au milieu d'un
prérendu est une ligne que personne ne lit dans un journal que personne ne garde.

### La leçon que le second garde a coûtée

Écrire cette seconde comparaison a produit un bug qui mérite sa place ici, parce
qu'il est plus général que son sujet.

La comparaison est mémoïsée : elle confronte 174 codes et le build l'appelle une
fois par page. **La première version mémoïsait le fait d'avoir tourné, pas le
verdict.** Elle stockait un booléen et sortait tôt au deuxième appel. Conséquence
exacte : la première page du build échouait et **toutes les suivantes passaient**
— un garde qui cesse de garder à l'instant où il se déclenche, ce qui est
strictement pire que pas de mémo, parce qu'un build à plusieurs pages transforme
un refus franc en un échec qui a l'air intermittent.

C'est son propre test qui l'a attrapé, **en assertant deux fois** :

```ts
it("keeps refusing on every call, not only on the first", async () => {
  const build = await buildWith([...DRAWABLE_COUNTRY_CODES, "SG"]);

  expect(build).toThrow();
  expect(build).toThrow();
  expect(build).toThrow(/SG/);
});
```

Un seul `toThrow()` aurait été vert. La forme retenue est un mémo qui porte le
verdict et non son occurrence — `undefined` tant qu'il n'a pas tourné, `null`
quand il a tourné propre, le message sinon — et il est **délibérément tenu hors**
des deux caches voisins de `src/map/**`, qui sont documentés comme des
optimisations supprimables. Un contrôle de correction qui s'arrête de tourner
parce que quelqu'un a supprimé une `Map` est un mode de panne que ce dépôt a déjà
payé deux fois.

La leçon transférable : **un garde mémoïsé doit mémoïser son verdict, jamais son
exécution — et son test doit l'appeler deux fois.**

## Alternatives écartées

**Élargir `travels-in-world/map-entry-point` pour le validateur.** C'est la voie
courte, et c'est celle que l'ADR 0002 a passé un ticket à refermer. Une exemption
sur `src/content/**` rouvrirait sur la carte un droit d'accès profond que le
reste de `src/**` n'a pas — et l'ADR 0002 documente les trois façons dont une
exemption mal écrite emporte plus que sa cible.

**Exposer la réponse par la façade `@/map`.** Voie morte, et pas seulement pour
ce cas : `ERR_MODULE_NOT_FOUND: Cannot find package 'server-only'` sous Node nu,
échec à la résolution, donc indépendant de ce qu'on importe. Même mesure que
l'ADR 0011.

**Passer au millésime 50m, ou composer le 110m avec les micro-États du 50m.**
C'est l'alternative la plus intéressante, parce que **le ticket d'origine
croyait à tort qu'elle était hors budget**, et l'écarter pour cette raison-là
aurait été l'écarter pour une raison fausse. Remesuré pour cette ADR, à la
méthode exacte de `tests/map/world.test.ts` — projection `geoNaturalEarth1`,
arrondi à une décimale, `brotliCompressSync` à qualité maximale, plafond de
34 KiB :

| tracés servis                              | brotli                    |
| ------------------------------------------ | ------------------------- |
| 110m entier, 177 tracés (ce qui est livré) | 30 829 o — **30,1 KiB**   |
| 50m entier, 241 tracés                     | 186 868 o — **182,5 KiB** |
| 110m + les 64 codes manquants, 238 tracés  | 33 941 o — **33,1 KiB**   |
| idem en gardant les 3 côtes sans code, 241 | 34 085 o — **33,3 KiB**   |

Les deux premières lignes reproduisent exactement les chiffres de
`tests/map/world.test.ts:313` et d'`AGENTS.md`. La troisième reproduit à 0,1 KiB
près les **33,0 Ko** qu'`AGENTS.md` inscrit : la composition tient **sous** le
plafond de 34 KiB, elle n'a jamais été hors budget. La quatrième est là parce que
le compte de 238 suppose qu'on abandonne les trois géométries que le dataset
livre sans identifiant — Chypre du Nord, le Somaliland, le Kosovo — qui sont du
littoral que la carte dessine aujourd'hui ; les garder coûte 0,2 KiB de plus et
ne change pas la conclusion.

La voie a donc été écartée sur ses vrais défauts, et ils sont trois :

1. **il ne resterait que ~0,9 KiB de marge sur 34**, dans un plafond dont l'ADR
   0009 dit qu'un garde approché de trop près se fait relever puis ne garde
   plus rien ;
2. **il faudrait charger deux topologies aux simplifications différentes**, donc
   deux jeux d'arcs qui ne se raccordent pas aux frontières communes ;
3. **les onze codes qu'aucun millésime ne porte ne seraient toujours pas
   dessinés.** Le validateur resterait nécessaire de toute façon — ce qui retire
   à cette voie son seul argument.

Elle reste documentée avec son chiffre, dans `AGENTS.md` et ici, pour que le
prochain lecteur l'écarte sur ces trois motifs et non sur un budget imaginaire.

**Documenter les 75 codes indessinables dans `content/README.md`, sans garde.**
Écartée par la mesure qui a décidé le ticket : il attendait « au moins SG, MC,
MT, SM », c'est-à-dire une note en bas de page. Soixante-quinze codes ne se
documentent pas, ils se refusent.

**Un test qui compare, sans artefact** — c'est-à-dire garder le validateur
ignorant et se contenter de la suite. Insuffisant par construction : la suite
peut dire qu'une liste est fausse, elle ne peut pas donner au validateur une
liste qu'il n'a pas.

## Ce qu'on paie

**Un fichier généré de 479 lignes dans `src/`, à relire à chaque bump.** Le diff
est lisible — un code par ligne, trié — mais c'est un diff que quelqu'un doit
ouvrir, et la commande n'est lancée par rien.

**Un second module à la racine de `src/`.** `src/iso-3166.ts` était le premier ;
`src/basemap-coverage.ts` est le deuxième, et l'ADR 0011 avait nommé le
troisième comme son propre signal d'invalidation. Voir la note datée qu'elle
porte désormais.

**Deux lectures du même dataset, tenues en phase par des tests et non par le
typage.** Le script résout par `createRequire`, l'application importe
statiquement, et les deux nomment leur millésime dans une constante littérale
parce qu'un spécificateur d'import doit être un littéral. La dérive est
**attrapée, pas empêchée** — c'est écrit tel quel dans le script.

**Le garde de build ne tourne que si une page dessine la carte.**
`assertCoverageMatchesDataset` est appelée depuis `buildWorldGeometry` ; un jalon
où plus aucune page prérendue n'appelle la carte le rendrait muet sans qu'aucun
test ne rougisse. C'est le mode d'échec que l'ADR 0002 nomme déjà — « une façade
que rien n'importe n'est vérifiée par aucun build » — appliqué à un garde plutôt
qu'à un guard.

**Le motif est maintenant établi et il se répétera.** C'est le prix le moins
visible : il y a désormais une réponse toute faite à « ma couche ne peut pas
atteindre cette donnée », et elle est bonne. Elle sera aussi la réponse par
défaut à des cas où une meilleure structure existait.

## Ce qui invaliderait cette décision

1. **Un troisième artefact généré de la même famille.** À un, c'est un remède ; à
   deux, c'est un motif ; à trois, c'est une couche de données dérivées qu'il
   faudra nommer — avec sa convention de génération, son garde de fraîcheur
   commun, et probablement une étape de CI qui régénère et refuse un diff plutôt
   que deux comparaisons écrites à la main.
2. **Un artefact qui cesse d'être une donnée simple.** Tant que la sortie est
   deux ensembles de chaînes, la couche non gardée ne dépend de rien. Le jour où
   l'on voudrait y mettre de la géométrie — des tracés précalculés, des boîtes
   englobantes — l'artefact recommencerait à peser, et le budget de 34 KiB
   redeviendrait la question.
3. **`server-only` devenu résolvable.** C'est le second signal de l'ADR 0002 et
   le premier de l'ADR 0011 ; il les invalide toutes les trois ensemble, parce
   que la façade cesserait d'être une voie morte pour un script Node.
4. **Une règle raisonnant sur des chemins résolus** (`import/no-restricted-paths`
   et ses zones, déjà pesée par les ADR 0001 et 0002). Elle ne supprimerait pas
   le besoin de l'artefact — la frontière resterait une frontière — mais elle
   changerait la façon dont on écrit qui a le droit de le lire.
5. **Une génération automatique en CI.** Ce serait le signal que la fraîcheur
   n'est plus tenable à la main, et alors les deux gardes actuels deviendraient
   redondants avec le mécanisme qui les remplace. Rien ne l'indique aujourd'hui :
   le fichier n'a été régénéré qu'une fois.

Aucun de ces signaux n'est présent aujourd'hui.
