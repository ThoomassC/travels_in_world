# `home-map` — le contenu que la suite end-to-end sert à l'accueil

Quatre voyages, choisis pour que la carte et son équivalent textuel (TIW-15) ne
puissent pas passer verts par hasard :

| Voyage               | Pays  | Ce qu'il rend observable                                    |
| -------------------- | ----- | ----------------------------------------------------------- |
| `japon-2024`         | JP    | deux villes dans **un** pays : un voyage, pas deux          |
| `japon-2025`         | JP    | un pays qui porte **deux** voyages : un compte ≠ 1          |
| `perou-bolivie-2023` | PE BO | un voyage qui traverse **deux** pays : il en teinte deux    |
| `islande-2022`       | IS    | un pays lointain, qui étire le cadre sans le rendre mondial |

Soit **4 voyages, 4 pays** et, par ordre alphabétique français : Bolivie 1,
Islande 1, Japon 2, Pérou 1. Le compte par pays est précisément ce que la carte
ne portait dans aucun canal, donc c'est la table que la suite vérifie.

**Un seul des quatre porte des photos, depuis TIW-17.** `japon-2024` en déclare
quatre — une couverture, une rattachée à un lieu, deux libres — parce que la
visionneuse ne s'éprouve que sur une page de voyage qui en a, et que ce dossier
est déjà servi par un build de production que la suite paie de toute façon. Un
troisième build pour quatre images aurait coûté plus que les images.

Les trois autres restent **sans photo, volontairement**, et c'est la raison
d'origine de cette ligne : `coverPhotoSrc` est optionnel et `TripCard` rend un
substitut quand il manque. Les deux branches sont donc exercées — trois cartes
sur le substitut, une sur une vraie couverture — là où quatre cartes identiques
n'en exerçaient qu'une.

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

Le cadre que ces quatre voyages produisent est **recadré et non mondial** :
`viewBox="177.3 0 764.4 398.2"`, soit 764 unités sur 960. C'est ce qui rend la
légende « recadrée » vérifiable de bout en bout, et c'est mesuré, pas supposé.
