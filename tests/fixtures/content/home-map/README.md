# `home-map` — le contenu que la suite end-to-end sert à l'accueil

Cinq voyages, choisis pour que la carte et son équivalent textuel (TIW-15) ne
puissent pas passer verts par hasard :

| Voyage               | Pays  | Ce qu'il rend observable                                    |
| -------------------- | ----- | ----------------------------------------------------------- |
| `japon-2024`         | JP    | deux villes dans **un** pays : un voyage, pas deux          |
| `japon-2025`         | JP    | un pays qui porte **deux** voyages : un compte ≠ 1          |
| `perou-bolivie-2023` | PE BO | un voyage qui traverse **deux** pays : il en teinte deux    |
| `islande-2022`       | IS    | un pays lointain, qui étire le cadre sans le rendre mondial |
| `maroc-2023`         | MA    | un voyage **sans récit** : teinté, listé, et sans page      |

Soit **5 voyages, 5 pays** et, par ordre alphabétique français : Bolivie 1,
Islande 1, Japon 2, Maroc 1, Pérou 1. Le compte par pays est précisément ce que
la carte ne portait dans aucun canal, donc c'est la table que la suite vérifie.

**Le cinquième est arrivé avec TIW-18**, et il porte `story: unwritten`. C'est le
seul état que les quatre autres ne pouvaient pas rendre observable : le Maroc est
teinté d'un état distinct parce qu'aucun voyage raconté ne l'atteint, sa balise
mène vers `/fr/voyages#voyage-maroc-2023` et non vers une page qui n'existe pas,
sa fiche affiche « Récit à venir », et son adresse `/fr/voyages/maroc-2023`
répond 404 — quatre pages de voyage prérendues pour cinq voyages, ce que le
tableau de route du build montre.

Marrakech n'est pas un choix d'ambiance : ses coordonnées tombent **strictement à
l'intérieur** de l'emprise des quatre autres balises (Cusco à l'ouest et au sud,
Tokyo à l'est, Reykjavik au nord). Le cadre reste donc
`viewBox="177.3 0 764.4 398.2"` à l'unité près — mesuré sur le build — et aucun
test qui affirme ce cadre n'a eu à bouger pour une raison qui n'est pas la sienne.

Il est aussi **absent du sitemap et du flux RSS**, vérifié sur les artefacts : les
deux annoncent des adresses, et un `<item>` de flux est suivi des mois plus tard
depuis un logiciel qui l'a gardé.

**Les quatre dates de publication sont dans un ordre différent de celui des
voyages, depuis TIW-19**, et c'est le piège du ticket écrit dans la donnée :

| Voyage               | Voyage (startDate)          | Récit publié (publishedAt)         |
| -------------------- | --------------------------- | ---------------------------------- |
| `japon-2025`         | 2025-03-02 ← le plus récent | 2025-03-20                         |
| `maroc-2023`         | 2024-10-05                  | 2024-10-20 (récit non écrit)       |
| `perou-bolivie-2023` | 2023-07-04                  | **2026-01-05 ← le dernier publié** |
| `japon-2024`         | 2024-04-12                  | 2025-06-10                         |
| `islande-2022`       | 2022-09-10 ← le plus ancien | 2024-11-03                         |
| `maroc-2023`         | 2023-02-05                  | 2023-02-20 (récit non écrit)       |

Le badge « nouveau récit » suit la **publication**, donc il se pose sur
`perou-bolivie-2023` — pas sur `japon-2025`, qui ouvre pourtant la liste des
derniers voyages. Une implémentation qui lirait `startDate`, ou qui ferait
confiance à l'ordre que la façade de contenu lui donne, badgerait le Japon et
passerait sur n'importe quel jeu de données où les deux ordres coïncident. Les
trois premières positions des deux colonnes diffèrent, donc l'ordre du flux RSS
est vérifiable lui aussi.

`playwright.content.config.ts` fixe `TIW_BUILD_DATE=2026-01-06`, soit J+1 après
cette publication : sans cette date injectée, le badge serait fonction du jour
où la suite tourne.

**La date de voyage de `maroc-2023` est contrainte, et elle l'a été par un échec.**
Placé en octobre 2024, il devenait le deuxième plus récent et entrait dans les trois
cartes de « Derniers voyages » — ce qui en chassait `perou-bolivie-2023`, soit
précisément le voyage que cette fixture fait porter le badge. `fresh-trip.populated.spec.ts`
l'a dit tout de suite. En février 2023 il est quatrième par date de voyage, la liste
des trois derniers ne bouge pas, et les quatre positions du flux que ce même fichier
affirme non plus — il en est absent, comme du sitemap.

La fiche « Récit à venir » reste donc exercée sur l'accueil, mais par le **panneau de
la carte**, qui rend la même `TripCard` : ce qui est exactement le second endroit que
le critère d'acceptation nomme, « les listes et le panneau de carte ».

**Un seul des cinq porte des photos, depuis TIW-17.** `japon-2024` en déclare
quatre — une couverture, une rattachée à un lieu, deux libres — parce que la
visionneuse ne s'éprouve que sur une page de voyage qui en a, et que ce dossier
est déjà servi par un build de production que la suite paie de toute façon. Un
troisième build pour quatre images aurait coûté plus que les images.

Les autres restent **sans photo, volontairement**, et c'est la raison d'origine de
cette ligne : `coverPhotoSrc` est optionnel et `TripCard` rend un substitut quand
il manque. Les deux branches sont donc exercées — quatre cartes sur le substitut,
une sur une vraie couverture — là où quatre cartes identiques n'en exerçaient
qu'une. Depuis TIW-18 le substitut n'est plus un aplat : c'est une tuile portant le
pays et l'année, et `maroc-2023` la montre sous l'état « récit à venir ».

Les huit binaires pèsent 68 Ko en tout : les originaux sont générés lisses par
`tests/content/images.ts` (`smooth: true`), parce qu'un grain est incompressible
par construction et qu'une même photo de 600 × 400 fait ~90 Ko bruitée contre
~10 Ko lisse. `width`, `height` et `blurDataUrl` y ont été écrits par
`npm run index-photos`, et les `-480.avif` par la même commande.

Servi par **`playwright.content.config.ts`** via `TIW_CONTENT_DIR`, sur son propre
port (3278) et dans le `.next` par défaut : `npm run test:e2e` enchaîne les deux
configs **séquentiellement**, celle-ci d'abord. Les deux états sont testés parce
que les deux sont réels — le dépôt a `content/trips` vide, ce qui est la production
d'aujourd'hui, et ceci est la production d'après TIW-24.

Le cadre que ces voyages produisent est **recadré et non mondial** :
`viewBox="177.3 0 764.4 398.2"`, soit 764 unités sur 960. C'est ce qui rend la
légende « recadrée » vérifiable de bout en bout, et c'est mesuré, pas supposé.
