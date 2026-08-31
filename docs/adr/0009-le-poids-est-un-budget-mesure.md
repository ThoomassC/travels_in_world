# 9. Les dépendances écartées sont gardées par un budget, pas par une liste

- **Statut** : accepté
- **Date** : 2026-08-31
- **Contexte du ticket** : décisions prises à TIW-7 (socle), TIW-12 (tracés) et
  TIW-28 (empreinte), consignées rétrospectivement par TIW-27

## Contexte

Ce projet a une liste de dépendances écartées, et cette liste existe déjà : pas
de bibliothèque de carte côté client, pas de gestionnaire d'état, pas de client
HTTP ni React Query, pas de bibliothèque de formulaires, pas de Tailwind, pas de
CSS-in-JS, pas de bibliothèque d'icônes React. Elle est dans `AGENTS.md` et dans
le README.

Le problème d'une liste, c'est qu'elle se relit une fois puis se contourne
honnêtement. Personne n'ajoute Leaflet en pensant mal faire : quelqu'un a besoin
d'un zoom, la bibliothèque est la voie évidente, et la liste ne dit pas ce que ça
coûte. Une interdiction déclarative n'a pas d'unité de mesure, donc elle n'a pas
d'argument à opposer à un besoin réel.

Ce dépôt a d'ailleurs déjà retiré une dépendance de cette nature :
`@tabler/icons-react` en est partie, les icônes étant du SVG rendu au build
plutôt que des composants client. C'est un fait, pas une intention — et c'est ce
genre de fait qu'un budget produit.

## Décision

**La liste est conservée, mais ce qui la défend est un chiffre.** Trois plafonds,
chacun assis dans un test qui lit un artefact réel, chacun assez haut pour
laisser passer du vrai travail et assez bas pour qu'une bibliothèque de carte ou
un jeu d'icônes le traverse immédiatement.

| budget                          | plafond | garde                           | mesuré ce jour     |
| ------------------------------- | ------- | ------------------------------- | ------------------ |
| JS initial, par route prérendue | 150 Ko  | `tests/build/prerender.test.ts` | 119,9 Ko sur `/fr` |
| HTML, par route prérendue       | 100 Ko  | `tests/build/prerender.test.ts` | 35,8 Ko sur `/fr`  |
| tracés du planisphère           | 34 Ko   | `tests/map/world.test.ts`       | 30,1 Ko            |

Tout est en **brotli à qualité maximale** — ce qu'un CDN livre réellement, donc
ce qu'un budget doit compter.

Trois propriétés de ce dispositif ne sont pas évidentes et décident de son
efficacité.

**1. Le budget est par route, pas global.** Ne mesurer que `/fr` a coûté
exactement ce que ce genre d'angle mort coûte : 12,4 Ko du `Link` client de
next-intl dormaient dans le bundle initial de `/_not-found`, la seule route que
rien ne regardait, pendant que `/fr` était déclarée propre — pendant deux jalons
(ADR 0005). Et la liste des routes est **dérivée de
`.next/prerender-manifest.json`**, jamais écrite en dur : une liste en dur avait
déjà déplacé le trou vers `/_global-error` au lieu de le boucher.

**2. Les deux budgets ne se financent pas l'un l'autre.** Les tracés du
planisphère ne sont pas du JavaScript — c'est de la donnée de chemin inline dans
le HTML. Le budget des tracés est donc un plafond séparé, et il est le seul des
trois à ne pas exiger de build : il recompresse une chaîne déterministe, donc il
tourne dans `npm run test`. Ce qu'il garde n'est pas la performance mais
**l'arrondi** : 30,1 Ko à une décimale contre 45,5 Ko à trois, et 182,5 Ko si l'on
passait au millésime `world-atlas` 50m. Son commentaire dit la seule chose qui
compte le jour où il rougit : « the fix is to find what stopped rounding — not to
raise the ceiling. »

**3. Un plafond ne suffit pas, et l'ADR 0005 l'a prouvé.** La régression de
`getPathname` valait 3,8 Ko : à 123,7 Ko elle passait les 150 Ko très
largement, et c'est pour cette raison qu'elle a traversé deux jalons. Resserrer
le plafond à 121 Ko l'aurait attrapée **et** aurait refusé les 3 Ko de travail
légitime suivants — or un garde qui bloque du vrai travail se fait relever par la
personne pressée qui vient après, puis ne garde plus rien. La réponse retenue est
donc un garde d'**identité** et non de quantité : un test refuse la présence du
`Link` client de next-intl dans tout chunk initial de toute route prérendue,
reconnu par trois noms de propriétés que la minification ne peut pas renommer
sans changer la forme de l'objet.

C'est la leçon transférable de cette ADR : **un budget attrape ce qui est gros,
une empreinte attrape ce qui est interdit.** Les deux sont nécessaires.

### Deux gardes qui gardent leur propre mécanisme

Le chunk `noModule` — le bundle de compatibilité que jamais aucun navigateur
moderne n'exécute — est exclu de la mesure : le compter gonflerait le chiffre de
34,3 Ko mesurés, soit près d'un quart du budget dépensé en octets que personne ne
télécharge. Mais l'exclusion elle-même est gardée : le test exige
`excludedNoModule > 0`, pour que le jour où Next cesse d'émettre ce chunk
l'exclusion soit signalée comme du code mort plutôt que de pourrir en silence.

Même forme sur le comptage : le test exige `counted.size > 0`. Sans cette ligne,
une version de Next déclarant sa charge initiale autrement — `modulepreload`,
manifeste inline — vidait la mesure et le test annonçait un succès **sur zéro
octet**.

### Ce que le budget a réellement acheté

La carte du monde est l'exemple qui justifie tout le dispositif. Elle est du SVG
calculé au build par d3-geo, et elle coûte **zéro octet de JavaScript client** —
mesuré identique à l'octet, à 0 comme à 60 voyages. `d3-geo`, `topojson-client`
et `world-atlas` sont en `dependencies` et non en `devDependencies` parce que
Turbopack les inline dans le bundle **serveur** au build ; vérifié après coup,
`grep -rl "geoNaturalEarth|topojson|Topology|world-atlas" .next/static` est vide
avec la carte réellement consommée par une page.

Une bibliothèque de carte cliente ferait la même chose en expédiant son moteur de
rendu au navigateur. Le budget est ce qui donne un chiffre à cette phrase.

## Alternatives écartées

**La liste seule, tenue en revue.** L'état antérieur. Écartée pour la raison du
contexte : aucune unité de mesure, donc aucun argument face à un besoin légitime.

**Un plafond unique et global sur tout le site.** Plus simple à écrire, et
strictement plus faible : il autorise une route à grossir aux dépens d'une autre,
et c'est précisément par là que 12,4 Ko sont passés.

**Un plafond serré plutôt qu'un garde d'identité.** Écartée par la mesure, voir
le point 3.

**Une dépendance d'analyse de bundle** (`@next/bundle-analyzer`, `size-limit`).
Elle donnerait de meilleurs rapports, et elle se pèse contre le budget qu'elle
sert à mesurer. Les gardes actuels tiennent dans deux fichiers de test et
`node:zlib`, sans rien ajouter à `package.json`. À reconsidérer le jour où la
question « quel module pèse ça ? » se poserait plus d'une fois par ticket.

**Interdire les dépendances par une règle ESLint** plutôt que par un budget. Le
dépôt le fait déjà, mais seulement pour ce qu'une façade encapsule —
`world-atlas`, `d3-*`, `topojson-*` (ADR 0002). Généraliser reviendrait à
maintenir une denylist de tout ce qui n'existe pas encore. Le budget a la
propriété inverse et c'est sa valeur : il ne connaît pas les noms, il constate
les octets.

## Ce qu'on paie

**Deux des trois budgets exigent un build.** Ils vivent donc hors de
`npm run test`, dans `npm run test:build`, et sont branchés en CI depuis TIW-22
ainsi que dans le `buildCommand` de `vercel.json`.

**Les mesures inscrites dans les commentaires vieillissent, et elles ont
vieilli.** Constaté en écrivant cette ADR, sur `develop` (2306e9a), build réel :

- `tests/build/prerender.test.ts:46` annonce `// measured: 1.6 KB /fr`. La valeur
  réelle est **35,8 Ko** — le commentaire est antérieur au câblage de la carte sur
  l'accueil, et il est faux d'un facteur ~22. Le plafond de 100 Ko tient très
  largement ; c'est la marge annoncée qui est fausse, pas la garde.
- Le README porte la même valeur périmée (« 1,5 Ko brotli de HTML »).
- L'ADR 0005 conclut que « le budget de JavaScript du jalon repasse de 30 à 38 Ko
  de marge sur 150 ». Les 38 Ko sont la marge de `/_not-found` (111,1 Ko). La
  marge qui compte est celle de la **route la plus lourde**, `/fr` à 119,9 Ko,
  soit **30,1 Ko** — ce que `AGENTS.md` dit correctement.

C'est le prix structurel d'un chiffre écrit dans un commentaire : le test reste
juste, la prose ment. Les plafonds, eux, sont dans le code et ne peuvent pas
dériver.

**Le budget ne juge pas la pertinence.** 119,9 Ko de JS initial pour un site
entièrement statique sont essentiellement le runtime React et Next ; le budget
constate qu'ils tiennent, il ne demande pas s'ils sont nécessaires.

**Deux des choix de la liste ne sont pas chiffrés, et il faut le dire.** L'absence
de Tailwind et de CSS-in-JS est défendue par une préférence — CSS nu avec des
custom properties, jetons dans `src/styles/tokens.css` — et non par une mesure de
ce dépôt. CSS-in-JS a un coût d'exécution client qui irait au budget JS ;
Tailwind n'en a pas. Écrire ici qu'ils sont écartés « pour le poids » serait
faux.

## Ce qui invaliderait cette décision

1. **Un besoin d'interaction qui demande vraiment du JavaScript** — le zoom
   continu de TIW-14, la visionneuse photo de TIW-17. Ils consomment les deux
   `'use client'` autorisés au jalon, et 30,1 Ko de marge sur `/fr`. Le jour où
   l'un des deux ne tient pas dans cette marge, la question n'est pas de relever
   le plafond : c'est de décider ce qui sort du bundle initial.
2. **Un budget approché de trop près.** Un garde à 5 Ko de sa limite bloque du
   travail légitime, se fait relever, puis ne garde plus rien. À ce moment-là il
   faut un découpage — chargement différé, route dédiée — pas un nouveau chiffre.
3. **Un plafond relevé sans que la mesure soit expliquée.** C'est le signal le
   plus important et le seul qui soit entièrement sous notre contrôle : un
   plafond qui monte dans le même commit que ce qui l'a fait monter est une
   décision ; un plafond qui monte seul est un garde qu'on vient de désactiver.
