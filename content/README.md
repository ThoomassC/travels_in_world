# content/ — les voyages, écrits à la main

Un voyage = **un dossier**, contenant **un `trip.yaml`**. Pas de base de données : ces
fichiers sont le contenu du site, versionnés avec le code, lus au build.

`content/trips/` est **vide pour l'instant** : les vrais voyages arrivent avec TIW-24. Le
dossier existe déjà pour que `npm run validate:content` ait quelque chose à lire, et pour
que la structure attendue soit écrite noir sur blanc avant le premier voyage.

## Structure

```
content/trips/
  japon-2024/            ← par convention, le nom du dossier est le slug du voyage
    trip.yaml
public/
  photos/
    japon-2024/
      tokyo.jpg          ← le fichier que « src: /photos/japon-2024/tokyo.jpg » désigne
```

Les chemins de photos sont **des chemins d'URL**, écrits depuis la racine du site
(`/photos/...`), et résolus dans `public/`. C'est ce que le navigateur demandera.

## Un `trip.yaml` complet

```yaml
slug: japon-2024 # minuscules, chiffres et traits d'union — c'est l'URL du voyage
title: Japon, printemps 2024
startDate: 2024-04-12 # toujours AAAA-MM-JJ, jamais une autre écriture
endDate: 2024-04-16

places:
  - slug: tokyo
    name: Tokyo # le nom tel qu'il s'affichera
    countryCode: JP # ISO 3166-1 alpha-2, deux lettres majuscules
    coordinates:
      lat: 35.6762
      lon: 139.6503
  - slug: kyoto
    name: Kyoto
    countryCode: JP
    coordinates:
      lat: 35.0116
      lon: 135.7681

steps: # dans l'ordre chronologique
  - kind: stay
    placeSlug: tokyo
    startDate: 2024-04-12
    endDate: 2024-04-16
  - kind: move
    fromSlug: tokyo
    toSlug: kyoto
    mode: train # plane, train, bus, car, boat, bike, foot
    date: 2024-04-16

photos: # facultatif
  - src: /photos/japon-2024/tokyo.jpg
    alt: Une ruelle de Shinjuku sous la pluie # obligatoire : c'est ce qu'annonce un lecteur d'écran
    width: 1600
    height: 1067
coverPhotoSrc: /photos/japon-2024/tokyo.jpg # facultatif, doit figurer dans photos[]

budget: # facultatif
  totalCents: 420000 # en centimes entiers : 4 200,00 € s'écrit 420000
  currency: EUR
  travellers: 2

tags: # facultatif, mêmes règles qu'un slug
  - asie
  - train
```

Le minimum vital est plus court : `slug`, `title`, `startDate`, `endDate`, un lieu et une
étape. Tout le reste est facultatif.

## Les règles que la validation fait respecter

Elles ne sont pas décoratives : chacune correspond à une page cassée, ou cassée en silence.

- **L'itinéraire est continu.** Un séjour suivi d'un déplacement part du lieu du séjour ;
  deux séjours de suite dans deux lieux différents veulent dire qu'il manque le
  déplacement entre les deux — et c'est l'édition la plus facile à rater, parce que tout le
  reste continue de se tenir.
- **Les étapes sont ordonnées** et tiennent dans les bornes du voyage.
- **Chaque étape renvoie à un lieu déclaré**, et chaque lieu déclaré est visité par une
  étape.
- **Les coordonnées ne sont ni absentes ni (0, 0)** : (0, 0) est la signature d'un
  géocodage raté, pas un endroit sur terre.
- **Chaque photo a un texte alternatif et ses deux dimensions**, et son fichier existe
  vraiment dans `public/`.
- **Les slugs sont uniques**, dans un voyage comme dans toute la collection : un slug est
  une URL.
- **Une clé inconnue est une erreur.** `lattitude:` au lieu de `latitude:` serait
  silencieusement ignorée, et le point serait faux sur la carte sans un mot. `__proto__:`
  est refusée à part : elle réécrirait le prototype de l'objet au chargement, et aucun
  schéma ne peut la voir.
- **La casse compte**, pour le nom du fichier (`trip.yaml`, pas `Trip.yaml`) comme pour les
  chemins de photos. Le système de fichiers d'un Mac ne fait pas la différence, celui de la
  CI et le CDN de production la font : `Tokyo.JPG` pour un fichier `tokyo.jpg` passerait ici
  et donnerait un 404 en ligne. La validation compare au nom réel sur le disque.
- **Un dossier de voyage sans `trip.yaml`, un lien symbolique cassé, un `.yaml` isolé à la
  racine** sont signalés. Seuls les noms commençant par un point sont ignorés (`.gitkeep`,
  `.DS_Store`).

### Corriger une faute peut en révéler d'autres

Ce n'est pas une régression, c'est l'ordre dans lequel la validation peut voir les choses.
Une clé inconnue ou une valeur du mauvais type interrompt la lecture de l'objet qui la
porte : tant qu'elle est là, les règles qui croisent plusieurs champs du voyage — la
continuité de l'itinéraire, l'ordre des étapes — n'ont rien à lire et ne disent rien.
Corrige `lattitude`, relance, et deux incohérences peuvent apparaître : elles étaient déjà
là, la validation ne pouvait pas encore les voir.

## Commandes

```bash
npm run validate:content          # valide content/trips/ ; rapporte tout, sort en 1 s'il reste un problème
npm run validate:content -- --help
```

Elle tourne aussi automatiquement avant `npm run test` (script `pretest`) : un contenu
fautif ne peut pas traverser la suite sans se faire voir.

Les messages nomment le fichier, la ligne, le champ et **la commande à lancer** :

```
content/trips/japon-2024/trip.yaml:13:5 — places[1].coordinates : la ville « Kyoto » est déclarée sans coordonnées → lance « npm run geocode japon-2024 »
```

Deux réparations ont leur commande dédiée (livrées par TIW-10) :

| Problème               | Commande                      |
| ---------------------- | ----------------------------- |
| coordonnées manquantes | `npm run geocode <slug>`      |
| dimensions de photo    | `npm run index-photos <slug>` |

### Valider autre chose que le contenu réel

Utile pour tester la validation elle-même, sans toucher aux voyages :

```bash
npm run validate:content -- tests/fixtures/content/valid-trip/trips \
  --public tests/fixtures/content/valid-trip/public
```

En variables d'environnement : `TIW_CONTENT_DIR` et `TIW_PUBLIC_DIR`. Un argument explicite
l'emporte sur l'environnement.
