# `home-map` — le contenu que la suite end-to-end sert à l'accueil

Quatre voyages, choisis pour que la carte et son équivalent textuel (TIW-15) ne
puissent pas passer verts par hasard :

| Voyage               | Pays  | Ce qu'il rend observable                                  |
| -------------------- | ----- | --------------------------------------------------------- |
| `japon-2024`         | JP    | deux villes dans **un** pays : un voyage, pas deux        |
| `japon-2025`         | JP    | un pays qui porte **deux** voyages : un compte ≠ 1        |
| `perou-bolivie-2023` | PE BO | un voyage qui traverse **deux** pays : il en teinte deux  |
| `islande-2022`       | IS    | un pays lointain, qui force le cadre à montrer le monde   |

Soit **4 voyages, 4 pays** et, par ordre alphabétique français : Bolivie 1,
Islande 1, Japon 2, Pérou 1. Le compte par pays est précisément ce que la carte
ne portait dans aucun canal, donc c'est la table que la suite vérifie.

Aucune photo, volontairement : `coverPhotoSrc` est optionnel et `TripCard` rend
un substitut quand il manque, ce qui évite d'embarquer quatre binaires pour un
test qui ne regarde pas les images.

Servi par `playwright.config.ts` via `TIW_CONTENT_DIR`, sur un second serveur et
un second `distDir` — le premier build reste celui du dépôt, dont `content/trips`
est vide, et qui est l'état de la production aujourd'hui. Les deux états sont
testés parce que les deux sont réels : celui-ci est la production d'après TIW-24.
