# Un lieu visité est une entité de premier rang, dans sa propre collection

- **Ticket** : TIW-36
- **Statut** : tranché, et écrit avant la première ligne de code
- **Décision voisine** : `docs/adr/0008-publication-des-brouillons-fail-closed.md`
  (les deux champs de publication), `docs/adr/0001-domain-purity.md` (le domaine
  valide la forme, la couche de contenu refuse le contenu)

Un ADR est dû sur cette décision — elle crée une seconde collection de contenu et
une cinquième porte au chargeur. Ce document en est la matière ; il ne prend pas
sa place, et `docs/adr/**` n'est pas touché par ce ticket.

## Le problème, en une phrase

Le client a donné quatorze lieux et **n'a pas les dates**. Un `Trip` exige
`startDate`, `endDate`, `publishedAt`, au moins un lieu et au moins une étape. La
contrainte dure du ticket est qu'**aucune date ne sera inventée** : une date de
voyage est un fait de la vie du client, et un 1er janvier de convention
s'afficherait comme un fait sur un site public, dans un `<time>` que
`TripCard` rend et que le flux RSS date.

Le regroupement retenu par le client est « un voyage par séjour réel ». C'est la
cible ; elle n'est pas atteignable aujourd'hui, parce qu'elle a besoin des dates
pour dire où un séjour commence et où il finit.

## Les deux voies, et ce qui casse dans chacune

### Voie 2 — un troisième état de `story`

Un « voyage » dont `startDate`, `endDate`, `steps` (et peut-être `publishedAt`)
seraient facultatifs. Une seule source, promotion triviale : c'est l'argument, et
il est réel.

Ce que j'ai mesuré en lisant les consommateurs, du plus grave au plus anodin :

1. **`visitedCountryCodes` cesse de pouvoir teindre les cinq pays.** C'est le
   point qui décide, parce qu'il touche un critère d'acceptation de ce ticket même.
   La dérivation lit **les lieux que les étapes atteignent** — jamais `places[]` —
   et son en-tête dit pourquoi : « Reading `places[]` instead would count a
   leftover declaration ». Ce qui rend les deux lectures équivalentes aujourd'hui,
   c'est une paire de règles de `checkTrip` : chaque étape référence un lieu
   déclaré, **et** chaque lieu déclaré est référencé par une étape. Un voyage sans
   étape rend cette paire vide, donc `visitedCountryCodes` répond `[]`, donc
   `buildWorldGeometry` ne reçoit aucun code et **aucun pays n'est teinté**. La
   sortir de l'impasse demande de faire lire `places[]` à la dérivation, c'est-à-dire
   de retirer au domaine la règle qui garde les deux lectures d'accord.
   La voie 2 ne rend donc pas trois champs facultatifs : elle **dissout
   l'invariant `places` ↔ `steps`**, dont dépendent aussi `visitedPlaces`,
   `firstArrivalOf` et `drawableMoves`.

2. **`firstArrivalOf` n'a plus de réponse, et c'est une exception, pas un
   `undefined`.** Elle lit `trip.steps[0]` et jette `notFromTheSchema` sans étape.
   `summaryOf` l'appelle sans condition, donc **chaque** projection d'un lieu
   passerait par là. Or `firstArrival` est ce qui ancre la balise sur la carte :
   il faudrait une seconde façon d'ancrer, et l'ancrage cesserait d'être une
   propriété du voyage.

3. **`TripSummary` devient partout partiel.** `startDate`, `endDate`, `duration`,
   `firstArrival` et `publishedAt` sont requis dessus, et le type est consommé par
   `TripCard`, `buildCatalogue`, `LatestTrips`, `TripCatalogue`, `FreshTripBanner`,
   `freshestTrip`, `sitemap.ts`, `feed.xml/route.ts` et `tallyVisitedCountries`.
   Chacun devrait apprendre à rendre une absence — pour dire ce que « ce lieu n'a
   pas de récit » dit déjà.

4. **L'ordre de la collection n'a plus de clé.** `byMostRecentThenSlug` trie sur
   `startDate` descendant, et cet ordre est celui de l'accueil, de la liste et du
   plan de site — appliqué **une fois**, dans le chargeur, précisément pour qu'il
   ne se contredise pas ailleurs. Sans `startDate`, il faut soit une valeur de
   repli (une date inventée, refusée par le ticket), soit un second critère de tri
   dans la fonction qui existe pour n'en avoir qu'un.

5. **`publishedAt` est le champ dont l'obligation est argumentée le plus
   longuement du schéma**, et TIW-18 a déjà refusé de la lever pour
   `story: unwritten` : « making it optional here would hand `PlainDate |
   undefined` to every consumer to express something none of them asks ». La voie
   2 fait exactement ce que cette note refuse. À noter en sens inverse, parce que
   c'est la seule bonne nouvelle de la voie 2 : `publishedAt` pour un lieu serait
   *légitime* — « le jour où cette entrée est apparue » est un fait sur le site et
   non sur le client. Ce sont `startDate` et `endDate` qui ne peuvent pas être
   écrits, et ce sont précisément les deux qui empoisonnent `durationOf`, le tri
   et la fiche.

6. **Ce qui ne casse pas, et qu'il faut créditer** : `hasStory` est écrit
   `story === "written"` et non `!== "unwritten"` pour échouer *fermé* quand un
   troisième état arrive ; `tests/domain/trip.test.ts` rougit le jour où
   `STORY_STATES` grossit, « so the decision is taken rather than defaulted ». Le
   flux et le plan de site filtrent déjà sur `hasStory`, `freshestTrip` écarte
   déjà les voyages sans récit. Ces quatre-là fonctionneraient. Le troisième état
   a été *prévu* — mais prévu comme un état de **publication**, pas comme un
   voyage sans itinéraire.

7. **Et la duplication que la voie 2 est censée éviter, elle ne l'évite pas — elle
   la rend indétectable.** Mesuré sur le modèle : un slug de voyage est unique
   dans toute la collection, un slug de lieu est unique **dans un voyage**. Donc
   `annecy` comme slug de voyage-lieu et `annecy` comme `places[].slug` d'un
   voyage réel ne se heurtent à aucune règle : les deux coexistent, la carte pose
   deux balises au même endroit, et **rien ne le refuse**. C'est le renversement
   de l'argument décisif contre la voie 1.

### Voie 1 — une collection à part

`content/places.yaml`, lu par une porte de plus du chargeur.

L'objection décisive du ticket est juste : deux sources de lieux, et un lieu
promu devrait être retiré d'un endroit et écrit dans l'autre — la duplication
libre de diverger en silence qui a fait écarter la règle `vercel.json` de TIW-31.

**Elle est répondable, et c'est ce qui tranche** : la divergence est
*refusable*. Un slug de lieu déclaré à la fois dans `content/places.yaml` et dans
le `places[]` d'un voyage est une erreur de contenu, refusée par le chargeur et
rapportée avec sa ligne par `npm run validate:content`. La promotion devient
alors une édition **bruyante** : tant que les quatre lignes n'ont pas été
retirées du fichier des lieux, le build échoue en nommant les deux fichiers. Là où
la voie 2 laisse la même ville exister deux fois avec un build vert, la voie 1 la
refuse.

Ce que la voie 1 gagne en plus, et qui n'est pas de l'esthétique — quatre critères
d'acceptation deviennent vrais **par absence** plutôt que par une condition à
maintenir :

| critère                                             | voie 1                                                       |
| --------------------------------------------------- | ------------------------------------------------------------ |
| aucun lien vers une page inexistante                | un lieu n'a **aucune** porte de type `findX` / `xStaticParams` |
| le flux et le plan de site ne listent pas les lieux  | ils appellent `listTripSummaries()` : un lieu n'y est pas     |
| le badge « Nouveau » ne désigne jamais un lieu      | `freshestTrip` ne reçoit que des voyages                      |
| promotion sans réécrire le slug ni les coordonnées   | le bloc YAML d'un lieu **est** un élément de `places[]`       |

La dernière ligne est le cœur du dispositif : un lieu visité s'écrit exactement
comme un lieu de voyage — `slug`, `name`, `countryCode`, `coordinates` — parce
que c'est **le même schéma Zod**, `PlaceSchema`, et non une copie. Promouvoir un
lieu, c'est déplacer des lignes contiguës d'un fichier vers le `places[]` d'un
`trip.yaml`, puis écrire l'étape. Le slug ne bouge pas, les coordonnées ne
bougent pas, et rien n'est à géocoder une seconde fois.

## La décision

**Voie 1.** Un lieu visité est une entité de premier rang, dans sa propre
collection, et il n'a ni date, ni étape, ni récit, ni page.

### Ce qui est écrit où

```
content/places.yaml        ← la collection, un fichier
  places:
    - slug: rouen
      name: Rouen
      countryCode: FR
      coordinates:          ← écrit par « npm run geocode:places », jamais à la main
        lat: 49.4432
        lon: 1.0999
```

Un fichier et non un dossier par lieu : quatorze dossiers de quatre lignes se
lisent moins bien qu'une liste de quatorze entrées, et la liste **est** un
`places[]` de voyage, ce qui est tout l'intérêt pour la promotion. Le chemin est
réglable par `--places <fichier>` et `TIW_PLACES_FILE`, comme `--content` et
`--public` le sont déjà.

### Les couches, et ce que chacune refuse

| couche                  | ce qu'elle décide                                                     |
| ----------------------- | --------------------------------------------------------------------- |
| `src/domain/schema.ts`  | la **forme** : `VisitedPlacesSchema`, qui réutilise `PlaceSchema` tel quel |
| `src/content/loader.ts` | la **cinquième porte**, `listVisitedPlaces()`, et la disjonction avec les voyages |
| `src/content/validate.ts` | la même disjonction, avec fichier, ligne, colonne et commande       |
| `src/app/[locale]/page.tsx` | la jointure des deux façades, comme pour les voyages               |

Le domaine ne connaît pas la collection : `VisitedPlacesSchema` voit un fichier à
la fois, donc l'unicité d'un slug **entre** un lieu et un voyage est décidée par
la couche de contenu — exactement la répartition que l'ADR 0001 impose et que
`duplicateSlugFindings` applique déjà aux slugs de voyage.

### La cinquième porte, et pourquoi elle ne casse pas le mécanisme des quatre

TIW-18 a séparé les quatre portes en deux paires : `listTripSummaries` et
`loadTrips` **rendent**, `tripStaticParams` et `findTrip` **refusent**. C'est ce
qui fait de « aucun lien vers une page inexistante » une propriété du build.

`listVisitedPlaces()` entre dans la première paire et **n'a pas de contrepartie
dans la seconde**. Ce n'est pas un oubli à combler plus tard : c'est la forme de
la garantie. Il n'existe aucune fonction capable de rendre une adresse pour un
lieu, donc aucun chemin de code ne peut construire un lien vers une page de lieu
— pas même une route ajoutée l'année prochaine.

Conséquence directe sur la balise : une balise de lieu doit tout de même être un
`<a href>` (un `<a>` sans `href` n'a pas de rôle de lien, et le panneau serait
inatteignable au clavier — c'est le raisonnement déjà écrit sur `mark.href`).
Elle pointe donc, comme la balise d'un voyage sans récit, vers **ce qui existe
certainement** : l'entrée du lieu dans l'équivalent textuel de la carte, sur la
page même, `#lieu-<slug>`.

### `publishedAt` : absent, et c'est un refus

Un lieu ne porte **aucune** date. Pas même « le jour où cette entrée est
apparue », qui serait pourtant un fait honnête sur le site : le champ n'a aucun
consommateur pour un lieu — pas de flux, pas de plan de site, pas de badge, pas
de tri chronologique — et l'écrire serait ouvrir la porte à ce que quelqu'un le
lise un jour comme une date de voyage. L'ordre des lieux est **alphabétique par
nom localisé**, ce qui est un choix de présentation et non un fait sur le client.

### Ce qu'on paie, sans l'arrondir

1. **Deux collections de contenu**, et donc deux fichiers à lire pour savoir où le
   client est allé. La disjonction est refusée, pas la lecture.
2. **Une porte de plus** au chargeur — cinq, là où l'en-tête de `loader.ts`
   argumente longuement sur quatre. Le commentaire est mis à jour, pas contourné.
3. **La légende de la carte doit apprendre un second compte.** Elle dit
   aujourd'hui « N voyages, M pays » depuis `marks.length` ; avec quatorze lieux
   et zéro voyage elle dirait « 14 voyages », ce qui est faux. Elle gagne donc une
   phrase pour les lieux, et le libellé du recadrage cesse de dire « recadrée sur
   les voyages publiés » — le cadre est désormais calculé sur des balises dont
   aucune n'est un voyage.
4. **L'équivalent textuel doit compter les lieux**, sans quoi il afficherait
   « Aucun pays sur la carte pour l'instant » pendant que la carte en teint cinq.
   C'est le même défaut de canal unique que l'audit de TIW-20 a trouvé sur la
   première teinte.
5. **Les specs E2E non peuplées changent d'état de référence.** Elles assèrent
   aujourd'hui le journal vide, qui est la production ; la production cesse d'être
   vide avec ce ticket.

### Ce qui invaliderait cette décision

1. **Les dates arrivent.** C'est le cas nominal : chaque lieu devient une étape
   d'un voyage, `content/places.yaml` se vide, et la porte se retire. La décision
   est conçue pour disparaître.
2. **Un lieu a besoin d'une page.** Il faudrait alors une paire de portes qui
   refusent, et la garantie « aucune adresse de lieu ne peut être construite »
   cesserait d'être structurelle.
3. **Un troisième type de contenu** de la même famille. À un, c'est une seconde
   collection ; à deux, c'est une notion de « fiche » qu'il faudra nommer, avec sa
   règle de disjonction commune.
