# 3. La carte est un SVG inerte surmonté de balises HTML

- **Statut** : accepté
- **Date** : 2026-08-21
- **Contexte du ticket** : TIW-13 (carte du monde avec une balise par voyage)

## Contexte

La carte est la page d'accueil du journal : c'est elle qui doit faire comprendre
l'étendue des voyages **sans un clic**. Elle a trois choses à montrer — la forme
du monde, les pays visités, un point par voyage — et une seule à rendre
actionnable : le point.

Trois contraintes du projet encadrent la réalisation, et aucune n'est négociable
au jalon 1.

**Le budget de JavaScript client est à 30 Ko sur 150** (120,2 Ko brotli mesurés,
`tests/build/prerender.test.ts`), et `AGENTS.md` n'autorise que **deux**
composants `'use client'` sur tout le jalon — dont un seul pour la carte, réservé
à l'interaction de TIW-14. TIW-13 doit donc coûter **zéro** octet de JavaScript.

**La géométrie n'appartient pas à cette couche.** `src/map/**` (TIW-12) calcule
au build les 177 `<path>` du planisphère et la projection d'un point, dans une
boîte fixe de 960 × 500 — le défaut exact de `geoNaturalEarth1()`. Sa façade
porte `import "server-only"`, dont le régime est décidé par l'ADR 0002 et non
ici : le guard n'est atteint que par un import **de valeur**, un `import type`
étant effacé avant toute résolution. Ce qui suit ne dépend donc pas du guard.

**Un critère d'acceptation impose une cible d'interaction de 44 px « indépendante
de la taille dessinée de l'icône »** (WCAG 2.2, SC 2.5.8), et un autre impose que
les pays non actionnables ne soient « ni focusables, ni survolables — ce qui
n'est pas actionnable ne doit pas ressembler à un bouton ».

## Décision

La carte est un `<svg>` **entièrement inerte** — `aria-hidden="true"`,
`focusable="false"`, `pointer-events: none`, aucun `tabindex`, aucune règle
`:hover` — surmonté d'un **calque HTML** de `<a>` positionnés en pourcentages.
Le cadrage se fait en écrasant l'attribut `viewBox`, jamais en reprojetant.

Rien de cette couche n'importe `@/map` ni `@/content/trips` **en valeur** :
géométrie et points projetés arrivent en props, et le seul appelant des deux
façades est `src/app/[locale]/page.tsx`.

Ce n'est pas une contrainte que le guard `server-only` impose — il autoriserait
un `import type` — c'est un choix de testabilité : le composant se rend sous
jsdom à partir d'une géométrie de sept formes, sans Next, sans disque et sans
d3, ce qui est la condition pour que le cadrage soit couvert par cent cas plutôt
que supposé. Les types de props sont en conséquence **plus étroits** que ceux de
la géométrie : un pays n'y porte qu'un code et un `d`, parce que c'est tout ce
que le dessin lit. Le sous-typage structurel rend le `CountryShape` de TIW-12
assignable sans une ligne d'adaptation, et `page.tsx` — le seul endroit qui voie
les deux — est l'endroit où un renommage en amont fait échouer le typecheck.

### Les balises sont du HTML, pas des formes SVG

C'est la seule disposition dans laquelle la cible de 44 px est réellement
indépendante du zoom. Un `<circle r="6">` vit dans l'espace utilisateur du SVG :
son rayon rendu est `6 × (largeurRendue / largeurDuViewBox)`, donc il grandit
quand on recadre et rétrécit quand on dézoome. Il n'existe pas de
`vector-effect` pour un rayon, et la propriété CSS `r` n'est pas portable. Un
`<a>` dimensionné en `rem` fait 44 px CSS quoi qu'il arrive, et le point dessiné
à l'intérieur fait la taille qu'on veut.

La conséquence est ce qui rend le second critère d'acceptation vrai **par
construction** plutôt que par une liste de règles CSS qu'un futur contributeur
pourrait défaire une par une : puisque le seul élément interactif de la carte est
le lien d'une balise, aucun pays ne peut être focusé, survolé ou cliqué. Il n'y a
rien à désactiver.

**La teinte des pays visités est donc une information, pas une affordance.** Ni
curseur, ni transition, ni contour au survol.

Cette décision a d'abord justifié le `<svg>` masqué par un raisonnement faux —
« l'information est aussi dans le compteur et dans la liste de liens ». Ce qu'il
a fallu ajouter pour qu'il devienne vrai est traité plus bas, sous « Le compteur
dit aussi **quels** pays ».

### Le cadrage recadre le `viewBox`, il ne reprojette pas

L'emprise des voyages est calculée sur les points **déjà projetés**, dans la
boîte 960 × 500, et le cadre résultant est émis comme `viewBox`. La projection
n'est pas touchée, les `<path>` ne sont pas recalculés : recadrer un `viewBox`
est un zoom exact.

Ce n'est pas seulement plus simple, c'est ce qui préserve une propriété mesurée
en amont : la boîte 960 × 500 n'est pas arbitraire, elle est l'échelle par défaut
de `geoNaturalEarth1()`, et c'est cette échelle qui rend l'arrondi des chemins à
une décimale suffisant — 30,1 Ko brotli au lieu de 45,3 à trois décimales.
Reprojeter sur l'emprise détruirait cette calibration pour un résultat visuel
identique.

Le prix, assumé : un ensemble de voyages qui enjambe l'antiméridien
(Nouvelle-Zélande et Chili) a une boîte englobante de presque toute la largeur du
monde, donc cadre le monde entier. Un rectangle ne s'enroule pas. Le corriger
demanderait une projection tournée, donc une reprojection.

Second prix, assumé aussi : les 177 pays sont sérialisés même quand le cadre n'en
montre que trois. Les élaguer casserait le dézoom de TIW-14 et rendrait la
géométrie dépendante du contenu — donc non mémoïsable, recalculée à chaque
édition. À 30 Ko brotli dans un budget document de 100 Ko (1,5 Ko avant ce
ticket), le calcul est favorable.

### La règle de cadrage est nommée, parce que ses cas dégénérés décident de tout

Dans cet ordre, dans `src/components/map/frame.ts` :

1. **Aucun point exploitable → le monde entier.** Ce n'est pas un cas
   théorique : `content/trips` est vide jusqu'à TIW-24, donc c'est le rendu de
   production **actuel**.
2. **Boîte englobante** des points finis seulement. Un `NaN` qui atteint
   `Math.min` donne `viewBox="NaN NaN NaN NaN"` et la carte disparaît sans un
   mot — même posture que `drawableMoves` dans `src/domain/route.ts`.
3. **Marge de 15 % du plus grand côté de l'emprise**, sur les deux axes. Le plus
   grand côté et non chaque axe : deux voyages à la même latitude ont une emprise
   de hauteur nulle, et une marge proportionnelle à cet axe vaudrait zéro.
4. **Largeur minimale de 30 % de la largeur du monde.** C'est la règle du voyage
   unique, dont l'emprise est un _point_ : marge nulle, surface nulle, et un
   `fitExtent` naïf zoome sans borne — le lecteur reçoit un aplat de l'intérieur
   d'un pays, sans côte, sans rien pour distinguer Osaka d'Odessa. 30 % est
   environ un continent : c'est un plancher de lisibilité, pas un réglage de
   goût, et c'est littéralement ce que demande le critère d'acceptation.
5. **Rapport d'aspect forcé à celui du monde**, en agrandissant le côté court.
   Jamais en rétrécissant le long, qui ferait sortir du cadre un point que la
   marge venait d'y faire entrer.
6. **Arrondi vers l'extérieur** (largeur et hauteur au-dessus, origine en
   dessous), pour qu'un point posé sur le bord du cadre non arrondi ne tombe pas
   hors du cadre arrondi.
7. **Plafonnement puis recalage dans le monde.** Grâce à (5) c'est toujours une
   simple translation : à rapport égal, un cadre pas plus large que le monde
   n'est pas plus haut que lui.

L'invariant que la suite vérifie comme tel : **tout point fini passé en entrée
est à l'intérieur du cadre rendu.**

### Le rapport d'aspect du conteneur est celui du cadre, exactement

Les balises sont positionnées en pourcentages du conteneur ; le SVG remplit ce
conteneur. Si les deux rapports diffèrent, `preserveAspectRatio` ajoute des
bandes et **chaque balise dérive de son pays**. Le rapport est donc passé au CSS
en custom property inline, calculée sur les **mêmes nombres arrondis** que le
`viewBox` — pas sur ceux du monde, dont l'arrondi indépendant de la largeur et de
la hauteur l'écarte de jusqu'à 0,1 unité.

C'est le seul usage de `style` inline de cette couche, et il est irréductible :
faire passer un nombre calculé au build jusqu'à une déclaration CSS n'a pas
d'autre voie sans JavaScript. Corollaire pour le jour où une politique de
sécurité de contenu arrivera (`vercel.json` n'en porte aucune aujourd'hui) :
**sans `style-src 'unsafe-inline'` ou un nonce, les styles inline sont ignorés et
toutes les balises se superposent en haut à gauche, sans aucune erreur
bloquante.** À traiter dans le ticket qui introduira la CSP.

### Un `<a href>` nu, et la locale résolue par la page

Le composant ne construit aucune URL : il rend `mark.href` tel quel. La page
calcule ce href avec `tripPath()` (`src/i18n/paths.ts`, où le segment `voyages`
est défini une fois) et `getPathname` de `@/i18n/navigation`, avec la locale
passée explicitement.

Ce n'est pas une entorse à l'invariant 2 du projet — la locale est bien gérée par
`@/i18n/navigation` — et le composant `Link` perdrait sur trois points. Il
enveloppe `next/link`, qui est un composant **client** : soixante balises ne font
pas zéro octet. Il **préfetche** les liens entrant dans le viewport, donc
soixante requêtes de payload RSC au chargement de l'accueil. Et le précédent
existe déjà, justifié, dans `src/app/not-found.tsx`, qui utilise `getPathname` et
une ancre nue pour la même raison.

La conséquence à connaître : la route `/voyages/[slug]` appartient à TIW-16 et
n'existe pas encore. Elle est sans effet aujourd'hui — zéro voyage publié, donc
zéro balise, donc zéro lien mort — et TIW-16 précède TIW-24 (l'arrivée des vrais
voyages) dans le jalon.

### Le nom accessible est du texte masqué, pas un `aria-label`

Chaque lien porte un vrai nœud de texte, visuellement masqué par
`clip-path: inset(50%)` et jamais par `display: none` ni `visibility: hidden`,
qui le retireraient de l'arbre d'accessibilité.

L'argument contre `aria-label` n'est **pas** le contrôle vocal, contrairement à
ce que disait la première version de cette décision : le texte n'étant pas
visible non plus, personne ne peut prononcer ce qu'il voit. La vraie raison est
qu'un `aria-label` est un _attribut_ — une chaîne qu'un traducteur ne voit jamais
en contexte et qu'aucun outil ne retrouve dans le DOM. Ici le libellé reste un
nœud de texte issu du catalogue.

Le libellé lui-même met le titre en premier (`{title}, {place}`) et non un verbe.
Soixante liens commençant tous par « Voir le voyage » sont soixante liens
indistinguables dans la liste de liens d'un lecteur d'écran et à la navigation
par première lettre ; le rôle « lien » dit déjà « voir ».

L'ordre du DOM des balises est celui que rend la façade de contenu — `startDate`
décroissant, puis `slug` croissant — et il n'est jamais retrié. Il vaut à la fois
l'ordre de tabulation et l'ordre de dessin : le voyage le plus récent est le
premier tabulé et le dernier peint, donc au-dessus en cas de chevauchement. Cet
ordre est **annoncé** dans le libellé de la liste, parce que les balises sont
posées dans l'espace et parcourues par chronologie : sans cela l'anneau de focus
saute d'un point à l'autre de la carte sans logique visible.

### Le compteur dit aussi **quels** pays, et pas seulement combien

C'est la correction la plus importante qu'un audit d'accessibilité a apportée à
cette décision, et elle contredit son premier raisonnement.

L'argument initial était : masquer le `<svg>` est acceptable parce que
l'information est aussi dans le compteur et dans la liste de liens. C'est vrai du
**dénombrement** et faux de l'**identité**. Le compteur donne un nombre ; le nom
d'une balise donne un titre de voyage et le lieu d'arrivée de sa première étape
seulement — un voyage traversant trois pays en teinte trois et n'en nomme qu'un.
Un lecteur d'écran entendait donc « 7 pays » sans jamais apprendre lesquels
(WCAG 1.1.1), et un lecteur qui ne distingue pas les deux teintes — mesurées à
**1,16:1** en thème clair — n'obtenait l'information par aucun canal (1.4.1).

Le `<figcaption>` porte donc, en texte visuellement masqué, l'énumération des
pays visités, formatée par `Intl.ListFormat`. Masquée et non imprimée parce que
le critère d'acceptation demande deux chiffres à cette légende et que quarante
noms de pays les noieraient. Le canal visuel non coloré qu'exige aussi 1.4.1 est
porté ailleurs : par l'**épaisseur** du contour des pays visités, pas par ce
texte.

L'équivalent textuel complet de la carte — voyages, étapes, itinéraires — reste
TIW-15. Une énumération de pays n'en est pas un : c'est la moitié manquante d'un
compteur.

### Les couleurs de la carte viennent des jetons, mais pas de n'importe lesquels

Aucune couleur n'est déclarée dans le CSS de la carte ; toutes viennent de
`tokens.css`. Le choix des jetons, lui, a dû être refait après mesure des
contrastes réellement composés (les alphas dans l'ordre de peinture, pas les
jetons bruts) :

- **le trait de côte porte la carte, pas le remplissage.** Terre sur mer mesure
  1,08:1 en clair et 1,17:1 en sombre : comme aplats, les continents sont
  invisibles. La forme du monde étant l'objet graphique nécessaire à la
  compréhension (1.4.11, 3:1), le trait est passé de `--border-subtle` — 1,37:1,
  et dont la déclaration dit elle-même `decorative only` — à `--control-border`,
  le jeton que la palette documente comme `>= 3:1`, mesuré à 4,26:1 sur la terre
  et 3,93:1 sur la mer. Même changement pour la bordure de la carte, qui à
  1,34:1 ne la séparait pas de la page ;
- **la distinction visité / non visité ne peut pas passer par le remplissage.**
  Mesuré : 1,16:1 en clair, et aucune valeur d'alpha ne suffit — 1,98:1 à α=0,5,
  3,15:1 à α=0,8, où la carte est devenue un aplat. Le contraste est donc porté
  par le contour en `--text-accent` (7,03:1), et sa différence d'**épaisseur**
  est le canal non coloré qui satisfait 1.4.1.

Une propriété fragile à connaître : la balise passe 1.4.11 dans les deux thèmes
mais par des mécanismes **opposés** — en clair c'est le point teal qui porte le
contraste et l'anneau blanc est invisible (1,11:1) ; en sombre c'est exactement
l'inverse. Supprimer l'un des deux « parce qu'il ne sert à rien » casse un thème
sans casser l'autre, et aucun test ne le voit.

## Conséquences

**Ce qu'on gagne.** Zéro octet de JavaScript pour une carte du monde
interactive-au-clavier. Toute la couche est testable sous Vitest sans Next, sans
`src/map/**` et sans `src/content/**` : les entrées sont des nombres et des
chaînes, donc les règles de cadrage se vérifient par centaines de cas en
millisecondes, cas dégénérés compris. Et le critère « les pays ne sont pas
focusables » n'est pas une promesse tenue par du CSS, il est structurel.

**Ce qu'on paie.** Les 177 pays sont dans le document même hors cadre.
L'antiméridien dégrade vers le monde entier. Le recadrage multiplie l'échelle,
donc l'épaisseur des traits de frontière : le CSS pose
`vector-effect: non-scaling-stroke` sur les chemins — une déclaration plutôt que
177 attributs, pour un rendu identique.

**Et surtout : à l'échelle du monde, le recouvrement des balises est la règle et
non le cas dégénéré.** C'est le prix le plus lourd de cette décision et il faut
le dire en chiffres, parce que la première version de ce document le présentait
comme un cas limite traité.

Les cibles sont en `rem` et la carte en pourcentage : les balises ne rétrécissent
pas quand la carte rétrécit. Sur une carte rendue à 1152 px, 44 px valent environ
14° de longitude — **Paris et Rome se recouvrent**. À 320 px, une balise occupe
16 % de la largeur et 31 % de la hauteur du cadre : deux voyages distants de
moins d'environ 58° de longitude se recouvrent. Avec une taille de police racine
à 24 px, trois balises couvrent la carte entière.

Ce qui est traité ici est plus étroit : les balises **coïncidentes ou
quasi-coïncidentes** — deux voyages partant de la même ville — sont écartées sur
un petit cercle déterministe, en groupant par cellule et non par égalité exacte
des pourcentages. La première version groupait sur l'égalité, ce qui laissait
passer deux lieux distants de plus de quatre kilomètres : Roissy et Paris
produisaient deux clés différentes, n'étaient donc pas écartés, et se
recouvraient au pixel près — la balise du dessous avec une aire cliquable nulle.

**Ce n'est donc pas une solution du recouvrement, seulement de son cas le pire.**
Séparer complètement deux cibles de 44 px demanderait de connaître la largeur
rendue de la carte, fluide et inconnue au build : un décalage en pourcentage ne
peut pas promettre une distance en pixels. Chaque `<a>` mesure bien 44 px — la
lettre du critère d'acceptation et de WCAG 2.5.8 est tenue — mais l'aire
réellement atteignable de la balise du dessous ne l'est pas.

Deux choses limitent la casse. Le regroupement des balises proches (clustering)
appartient à TIW-14, qui aura le zoom pour les séparer vraiment. Et **l'accès au
clavier n'est jamais concerné** : tous les liens sont dans le flux de tabulation
quel que soit leur recouvrement, ce qui fait du pointeur le seul mode dégradé.

**Ce qui invaliderait cette décision.**

1. Un besoin de zoom ou de panoramique **continu**, qui demanderait de recalculer
   le cadre côté client. Le calque HTML survivrait (les pourcentages se
   recalculent), mais le composant deviendrait client et consommerait le seul
   `'use client'` du jalon — c'est précisément le périmètre de TIW-14, et la
   frontière entre les deux tickets est là.
2. Un budget document approché de trop près, qui forcerait à élaguer les pays
   hors cadre — et donc à rendre la géométrie dépendante du contenu, ce que cette
   décision refuse.
3. Une politique de sécurité de contenu sans `unsafe-inline` ni nonce, qui
   rendrait le positionnement inline inopérant et exigerait de repenser la
   liaison entre les nombres du build et le CSS.

Aucun de ces signaux n'est présent aujourd'hui.
