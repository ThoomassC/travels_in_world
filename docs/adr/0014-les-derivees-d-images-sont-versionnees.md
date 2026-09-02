# 14. Les dérivées d'images sont versionnées, pas construites

- **Statut** : accepté
- **Date** : 2026-09-01
- **Contexte du ticket** : TIW-17 (galerie, photo de couverture et visionneuse),
  consignée rétrospectivement par TIW-33
- **Complète** : `docs/adr/0009-le-poids-est-un-budget-mesure.md`, dont elle
  ajoute le quatrième budget

## Contexte

Le modèle de contenu de ce projet est « des fichiers versionnés, aucune base de
données ». TIW-17 y fait entrer la première donnée binaire : des photographies,
et les trois largeurs d'AVIF qu'une page demande pour chacune.

Trois couches doivent s'accorder à l'octet sur ces noms de fichiers, et elles
vivent dans trois endroits qui ne peuvent pas s'atteindre — c'est pourquoi
l'échelle est dans `src/domain/photo.ts`, le seul module que les trois peuvent
importer :

- `src/content/index-photos.ts` **écrit** `tokyo-960.avif` ;
- `src/content/validate.ts` **vérifie qu'il existe** sur le disque ;
- `src/components/photos/photo-figure.tsx` **écrit son nom** dans le document.

La question que TIW-17 devait trancher est : **qui exécute la conversion, et
quand ?** Elle n'est pas rhétorique, parce que la réponse évidente était déjà
sur le disque. `next@16.3.1` embarque `sharp` en dépendance _optionnelle_ pour
son propre optimiseur d'images, et `next/image` convertit à la demande. Le
chemin le plus court était de ne rien écrire du tout.

Deux faits interdisent ce chemin court, et le second est celui qui décide.

**Le premier est le budget de l'ADR 0009.** `next/image` est un composant
client : il consomme du JavaScript initial sur toute page qui affiche une photo,
et le jalon 1 n'autorise que deux `'use client'`, tous deux déjà attribués — la
carte (TIW-14) et la visionneuse (`src/components/photos/photo-lightbox.tsx`,
TIW-17).

**Le second est que `<picture>` s'engage.** Un navigateur qui a retenu une
`<source type="image/avif">` ne revient **pas** à l'`<img>` si le fichier
répond 404 : il peint une image cassée. L'`<img>` n'est pas un filet de
sécurité, c'est le repli des navigateurs qui ne savent lire _aucun_ des types
listés. Donc l'existence de chaque dérivée est une propriété que quelqu'un doit
vérifier avant la mise en ligne, et « quelqu'un » ne peut pas être le build s'il
est aussi celui qui les fabrique.

## Décision

**Les dérivées sont produites par une commande d'auteur et committées avec
l'original. Le build ne convertit rien.**

`npm run index-photos <slug>` mesure chaque photo déclarée, écrit `width`,
`height` et `blurDataUrl` dans le `trip.yaml`, et écrit les rangs d'AVIF à côté
de l'original. Ces fichiers entrent dans git au même commit que la photo.

### Que le build ne convertit rien est vérifiable, pas déclaratif

Quatre constats, tous relevés sur `develop` @ `a9d73bc` pour cette ADR :

- **aucun `next/image` dans `src/**`** — les sept occurrences du nom sont des
  commentaires qui expliquent son absence ;
- **`next.config.ts` ne porte aucun bloc `images`**, donc l'optimiseur n'est ni
  configuré ni désactivé : il n'est jamais atteint ;
- **`sharp` n'est importé que par `src/content/photo-files.ts`** (plus trois
  fichiers de `tests/`), et ce module n'a qu'un consommateur,
  `scripts/index-photos.ts`. La règle `travels-in-world/content-facade` rend
  cette solitude structurelle et non coutumière ;
- **`sharp` est en `devDependencies`**, ce qui est la moitié la plus parlante :
  il est absent de ce que l'application déclare avoir besoin pour tourner. C'est
  l'inverse exact de `d3-geo`, `topojson-client` et `world-atlas`, que l'ADR 0009
  documente en `dependencies` **parce que** Turbopack les inline dans le bundle
  serveur au build. La carte est calculée au build ; les images, non, et le
  `package.json` le dit.

Contrôle direct après un `npm run build` complet : `find .next -name "*.avif"`
ne rend rien, et `.next/static/media` ne contient que les deux icônes de marque.
Aucune image n'est produite par le build.

### Ce qu'un build repaierait, mesuré

Mesuré pour cette ADR sur quatre photographies réalistes de 1600 × 1067 —
générées par `tests/content/images.ts`, qui peint une structure de couleur sur
du grain, précisément pour qu'un encodeur ait quelque chose à faire — soit douze
dérivées à trois rangs :

```
$ time node … scripts/index-photos.ts bench --content … --public …
4 photos indexées sur 4, 12 versions AVIF écrites, fichier réécrit.
real 1.45   user 9.25   sys 0.11      (trois exécutions : 1,45 / 1,45 / 1,44)
```

Dont **0,20 s** de démarrage du processus et du chargeur TypeScript, mesuré
séparément sur `--help`. La conversion elle-même coûte donc ≈ 1,25 s pour douze
dérivées, soit **≈ 0,31 s par photographie** en temps mural et 2,3 s de CPU —
`libvips` occupe déjà un pool de threads, ce qui est la raison écrite dans
`src/content/index-photos.ts` de ne pas paralléliser la boucle.

> **Écart signalé.** Le commentaire de `src/content/index-photos.ts:607` annonce
> « 0.73 s per photograph, measured on four realistic ones at three rungs each ».
> Non reproduit ici : 1,45 s **au total** pour les quatre, soit 0,36 s par photo
> démarrage compris. La mesure de TIW-17 n'est pas contestée — une autre machine
> donne un autre chiffre — mais elle n'est pas reproductible en l'état, et le
> chiffre retenu par cette ADR est celui ci-dessus, avec sa machine et sa méthode.

L'extrapolation qui porte la décision est linéaire et déterministe : à ce rythme,
**200 photographies coûteraient ≈ 63 s de conversion à chaque build**, et un build de la
plateforme part d'un clone, donc rien n'est mutualisé d'un déploiement au
suivant. Pour un résultat identique à l'octet, la sortie de `sharp` étant
déterministe à paramètres fixes — ce que la même propriété rend vérifiable :
relancer la commande sur un voyage déjà indexé ne réécrit rien et sort en 0.

### Le corollaire : un cinquième garde exécutable

Verser des binaires dans git est une dette que git ne rend jamais — une photo
supprimée aujourd'hui est encore dans l'historique demain. Le prix de cette
décision est donc un budget de plus, et il a la forme des autres :
`npm run check:photo-weight` refuse un dépôt dont les images **suivies par git**
dépassent **150 Mo**.

Trois propriétés, toutes lisibles dans `src/content/photo-weight.ts` :

- **il interroge `git ls-files`, pas le disque.** Ce qu'un clone paie est ce qui
  est _committé_ ; et `.gitignore` vient gratuitement avec, ce qui évite une
  seconde liste d'exclusions à faire dériver ;
- **le seuil est arithmétique et non rond** : 200 photos à 400 Ko font 80 Mo
  d'originaux, trois rangs coûtent entre 22 et 150 Ko par photo selon sa
  compressibilité, soit ~96 Mo pour 200 photos. Assez haut pour qu'un vrai
  voyage ne le touche jamais, assez bas pour qu'un dossier d'originaux non
  redimensionnés le touche ;
- **`>` et non `>=`** : un garde qui se déclenche _à_ la limite accuse le commit
  suivant celui qui l'a franchie.

Il est branché en CI (`.github/workflows/ci.yml:94`) et vit hors de
`npm run test`, pour une raison différente des quatre autres : ce n'est pas une
propriété du code mais du _dépôt_, et elle n'a rien à faire dans une suite
unitaire.

### La vignette de préchargement est en WebP, et c'est la mesure qui l'a décidé

C'est le seul endroit du pipeline où AVIF est la mauvaise réponse, et il mérite
d'être écrit ici parce qu'il ressemble à une incohérence. À 16 px de large, le
conteneur _est_ le fichier. Remesuré pour cette ADR sur une photographie
différente de celle de TIW-17, à qualité 45 :

| largeur | WebP | AVIF  | JPEG  |
| ------- | ---- | ----- | ----- |
| 8 px    | 74 o | 299 o | 293 o |
| 16 px   | 78 o | 311 o | 301 o |
| 20 px   | 98 o | 330 o | 332 o |

TIW-17 avait relevé 76 / 307 / 305 à 16 px ; l'écart de quelques octets est celui
de la photographie, pas de la méthode. **Le facteur quatre est reproduit**, et
c'est lui qui décide. La largeur de 16 px l'est aussi : 8 px ne gagne rien, 20 px
saute d'un quart. Le `data:` URI mesure **127 caractères**, exactement ce
qu'annonce `src/domain/photo.ts`, pour un plafond de 512 — et 113 o une fois
brotlissé dans le document, contre les 114 o annoncés.

Ce champ part dans le HTML de **chaque page qui montre la photo**, ce qui est la
raison du plafond : deux cents photos à 512 caractères feraient ~100 Ko de
document, soit la totalité du budget HTML de l'ADR 0009 dépensée en vignettes.

## Alternatives écartées

**`next/image` et l'optimiseur de Next.** Écartée sur le budget de l'ADR 0009
avant tout autre argument : c'est un composant client, et les deux `'use client'`
du jalon sont dépensés. Elle aurait aussi rendu le site dépendant d'un runtime
d'optimisation à la requête, là où tout le reste du projet est prérendu — ce qui
contredit l'invariant 1.

**Convertir au build, sans committer** (une étape `prebuild` appelant `sharp`).
C'est l'alternative sérieuse, et elle échoue sur trois points distincts :

1. elle repaie ≈ 63 s pour 200 photos **à chaque déploiement**, pour une sortie
   identique à l'octet, sans rien mutualiser puisqu'un build part d'un clone ;
2. elle rend `validate:content` incapable de faire son travail. Le contrôle
   d'existence des dérivées porterait sur des fichiers que le build est censé
   créer plus tard : il ne pourrait plus rien affirmer _avant_ la mise en ligne,
   et c'est exactement la boucle fermée que TIW-29 a payée sur les codes pays —
   un outil qui blanchit un fichier que le build refuse ensuite ;
3. elle ajoute `sharp` au chemin critique du déploiement. Un binaire natif qui ne
   s'installe pas sur la plateforme devient une panne de build, là où
   aujourd'hui il ne peut faire échouer qu'une commande locale.

**Un stockage externe dès maintenant** (CDN, bucket). C'est la réponse _au-delà_
du seuil, et elle est déjà écrite dans le message d'échec du garde : le champ
`src` devient une URL absolue. C'est un changement de **contenu** et non de
structure — ni le schéma ni les pages n'ont à bouger — et c'est précisément ce
qui autorise le garde à refuser plutôt qu'à avertir. L'adopter avant d'en avoir
besoin coûterait un service, des secrets et une étape de publication, pour un
dépôt qui pèse aujourd'hui 26 Ko d'images comptées.

**Un second palier de format** (WebP à côté d'AVIF). Refusée par la structure du
`<picture>` : l'`<img>` porte **l'original**, donc un navigateur sans AVIF a déjà
une photographie qui s'affiche. Un palier WebP doublerait le poids du dépôt pour
servir les navigateurs qui ont WebP et pas AVIF, et ces octets sortiraient du
même budget de 150 Mo.

**Un quatrième rang à 1920 px.** Mesuré par TIW-17 — non rejoué ici, et cité
comme tel : 119 Ko d'AVIF de plus par photo, soit 24 Mo sur 200, quand trois
rangs coûtent ~136 Ko par photo. Ajouter un rang est donc une décision sur le
seuil de 150 Mo, ce qui est la raison pour laquelle l'arithmétique vit dans
`src/domain/photo.ts` à côté de l'échelle.

## Ce qu'on paie

**Des binaires dans l'historique, définitivement.** C'est le prix nommé, et le
garde ne le supprime pas : il le plafonne.

**Le garde ne pèse pas tout ce qu'un clone paie, et il faut le dire.** Son
périmètre est `public/` et `content/`, délibérément — c'est un budget de
_contenu_, et l'élargir mêlerait les icônes SVG et le dataset `world-atlas`, qui
sont du code et ne grossissent pas. Relevé du jour :

| ensemble                        | fichiers | octets |
| ------------------------------- | -------- | ------ |
| images suivies par git, en tout | 17       | 78 351 |
| dont comptées par le garde      | 1        | 26 282 |
| dont `tests/fixtures/**`        | 15       | 49 235 |
| dont `src/app/apple-icon.png`   | 1        | 2 834  |

Autrement dit, **66 % des octets d'image du dépôt sont hors du compte**
aujourd'hui, et le chiffre que la commande imprime — « 1 image suivie par git,
26 Ko sur un seuil de 150,0 Mo » — répond à « combien pèse le contenu », pas à
« combien pèse un clone ». C'est le bon périmètre pour ce que le seuil défend ;
ce n'est pas le périmètre que son nom laisse croire.

**Zéro dérivée n'est committée sous `public/` à ce jour.** `content/trips/` est
vide : la décision est en vigueur et n'est exercée que par les fixtures — sept
AVIF sous `tests/fixtures/**`, dont trois rangs complets pour `valid-trip`. Elle
n'a donc pas encore rencontré son vrai régime, celui d'un auteur qui ajoute
quinze photos d'un coup.

**L'engagement du `<picture>` n'est prouvé par aucun test de ce dépôt.** C'est un
fait du HTML, écrit à quatre endroits du code — `src/components/photos/photo-figure.tsx:16`,
`src/content/validate.ts:727`, `tests/content/validate.test.ts:325`,
`tests/components/photos/photo-figure.test.tsx:55` — et vérifié par aucun. Le
seul test qui charge un vrai navigateur, `tests/e2e/photo-viewer.populated.spec.ts`,
le dit lui-même en en-tête : `next start` sert le `public/` du dépôt et non
celui de la fixture, donc **les photographies y répondent 404** et le décodage
d'un AVIF n'est jamais exercé. Ce que les tests prouvent, c'est que le validateur
refuse une dérivée manquante ; que le navigateur se comporte comme annoncé est
emprunté à la spécification. À ne pas confondre avec une garantie mesurée.

**Le diff d'un ticket de contenu porte des binaires.** Une relecture ne peut rien
en dire, et le seul contrôle possible est le poids. C'est assumé : c'est le même
prix que le contenu en YAML paie en sens inverse.

**La reproductibilité dépend de `sharp`.** La sortie est déterministe à version
fixe ; un bump de `sharp` ou de `libvips` qui changerait un octet ferait
réécrire toutes les dérivées au prochain passage de la commande, et le diff
serait illisible. Rien ne surveille ça aujourd'hui.

## Ce qui invaliderait cette décision

1. **Le seuil de 150 Mo approché.** Pas dépassé : approché. Un garde à 5 Mo de sa
   limite bloque du travail légitime, se fait relever, puis ne garde plus rien
   (ADR 0009, point 2 de sa propre section). La réponse écrite est le stockage
   externe, pas un nouveau chiffre.
2. **Un besoin de dérivée que l'auteur ne peut pas calculer d'avance** — un
   recadrage par appareil, une variante par langue, une image sociale composée à
   la volée. La commande d'auteur suppose que chaque octet servi est connu au
   moment du commit ; une variante décidée à la requête casse cette supposition,
   et c'est alors la question de l'optimiseur qui se rouvre en entier.
3. **Un `<picture>` qui cesserait de s'engager**, c'est-à-dire un navigateur
   qui replierait sur l'`<img>` en cas de 404 de la `<source>` retenue. Le
   contrôle d'existence de `validate:content` cesserait d'être une garde de
   correction pour devenir une optimisation. Rien n'annonce ça, et personne ici
   ne l'a mesuré dans un navigateur — voir « ce qu'on paie ».
4. **Un troisième consommateur de l'échelle qui ne pourrait pas atteindre
   `src/domain/photo.ts`.** Aujourd'hui les trois s'y accordent parce qu'ils
   peuvent tous l'importer. Un quatrième hors de `src/**` — un worker, une
   fonction de plateforme — reposerait la question là où TIW-29 et TIW-30 l'ont
   déjà posée, et la réponse serait probablement celle de l'ADR 0015 : un
   artefact généré.

Aucun de ces signaux n'est présent aujourd'hui.
