# content/ — les voyages, écrits à la main

Un voyage = **un dossier**, contenant **un `trip.yaml`**. Pas de base de données : ces
fichiers sont le contenu du site, versionnés avec le code, lus au build.

`content/trips/` est **vide pour l'instant** : les vrais voyages arrivent avec TIW-24. Le
dossier existe déjà pour que `npm run validate:content` ait quelque chose à lire, et pour
que la structure attendue soit écrite noir sur blanc avant le premier voyage.

Tu n'as pas à écrire ce fichier depuis une page blanche : `npm run new-trip <slug>` en pose
un squelette commenté (voir « Commandes » plus bas), et `npm run geocode <slug>` remplit les
coordonnées. Les deux sections ci-dessous décrivent la cible, pas le travail à la main.

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
    coordinates: # écrit par « npm run geocode », jamais à la main
      lat: 35.6762
      lon: 139.6503
  - slug: kyoto
    name: Kyoto
    countryCode: JP
    coordinates: # idem : une coordonnée tapée à la main passe la validation
      lat: 35.0116 # et met le point au mauvais endroit sans un mot
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
npm run new-trip japon-2024        # crée le dossier et un trip.yaml commenté, sans coordonnées
npm run geocode japon-2024         # résout les coordonnées des villes et les écrit dans le fichier
npm run validate:content           # valide content/trips/ ; rapporte tout, sort en 1 s'il reste un problème
npm run validate:content -- --help
```

`npm run validate:content` tourne aussi automatiquement avant `npm run test` (script
`pretest`) : un contenu fautif ne peut pas traverser la suite sans se faire voir. `geocode`,
lui, ne tourne jamais tout seul — il appelle un service en ligne, ce n'est pas quelque chose
qu'une suite de tests déclenche dans ton dos.

### Le `--` avant les options

Aucune de ces trois commandes ne reçoit une option si tu oublies le `--` : npm la garde pour
lui. Sans option, `npm run geocode japon-2024` suffit ; **dès qu'il y a une option**, il faut
écrire `npm run geocode -- japon-2024 --pick 1`. Ce que fait npm sinon, mesuré :

| Ce que tu tapes après le nom du script | Ce que le script reçoit | Ce que tu obtiens                                  |
| -------------------------------------- | ----------------------- | -------------------------------------------------- |
| `-- japon-2024 --pick 1`               | `japon-2024 --pick 1`   | ce que tu voulais                                  |
| `japon-2024 --pick 1`                  | `japon-2024 1`          | refus en code 2 — le message te dit d'ajouter `--` |
| `japon-2024 --pick=1`                  | `japon-2024`            | l'option a disparu, sans un mot                    |
| `mon-test --content=/tmp/bac`          | `mon-test`              | le voyage est créé dans le vrai `content/trips`    |
| `--help`                               | rien, npm ne lance pas  | l'aide de npm, en anglais                          |

Les deux dernières lignes sont les dangereuses : la forme `--option=valeur` ne laisse aucune
trace, donc aucun script ne peut la rattraper. Pour viser un autre dossier sans y penser,
`TIW_CONTENT_DIR` n'est jamais avalé.

### La boucle

`new-trip` écrit un squelette **volontairement incomplet** : les villes n'ont pas de
coordonnées, parce qu'une coordonnée inventée passe la validation et met le point au mauvais
endroit sans un mot. La suite s'enchaîne d'elle-même :

1. `npm run new-trip japon-2024` — le fichier existe, commenté champ par champ ;
2. tu remplis les noms de villes et leurs codes pays ;
3. `npm run validate:content` — refuse, et dit « lance `npm run geocode japon-2024` » ;
4. `npm run geocode japon-2024` — liste les homonymes, demande un numéro, écrit ;
5. `npm run validate:content` — vert.

### Ce que `geocode` refuse de faire

- **Il ne choisit jamais à ta place.** « Kyoto » renvoie Kyōto au Japon **et** Kyoto en
  Tanzanie ; prendre le premier résultat place le voyage à 8 000 km. Les candidats sont
  listés avec leur pays, leur région et leur population, et la commande demande un numéro.
- **Il contre-vérifie le pays.** Le code pays renvoyé par le service est comparé au
  `countryCode` du fichier. Divergence ⇒ rien n'est écrit **pour cette ville**, et le message
  dit lequel est lequel. C'est ce qui rattrape un mauvais numéro tapé à l'étape précédente.
- **Il refuse (0, 0)** et toute coordonnée hors des bornes du globe.
- **Il n'écrit jamais une ville au hasard, mais il garde ce qui est tranché.** Ville
  introuvable, service injoignable, 429, 500, réponse illisible, pays qui ne concorde pas :
  **cette** ville reste telle quelle, les autres sont traitées **et enregistrées** quand
  même, et la commande sort en 1. Un `q` au prompt suit la même règle : il abandonne **cette**
  ville, pas le run — la question suivante est posée, et tout ce qui a été tranché est écrit
  à la fin. C'est voulu : sortir en 1 sans rien écrire t'obligerait à refaire les choix déjà
  faits. Donc « code 1 » ne veut pas dire « fichier intact » — lis le diff, il ne contient
  que des lignes de coordonnées. Le seul cas où rien n'est écrit est celui où rien n'a été
  résolu : même contenu, même horodatage.
- **Il ne reformate rien.** Tes commentaires, l'ordre de tes clés, ton style de guillemets,
  ton indentation et tes lignes vides sont conservés — seules les lignes de coordonnées
  apparaissent dans le diff.
- **Il ne fait rien deux fois.** Sur un voyage déjà complet il dit « toutes les villes ont
  déjà leurs coordonnées » et ne réécrit pas le fichier : même contenu, même horodatage.

Pour l'automatiser, `--pick <n>` répond à une ambiguïté sans rien demander, et se répète
autant de fois qu'il y a d'ambiguïtés. Noter le `--`, sans quoi npm garde les options :

```bash
npm run geocode -- japon-2024 --pick 1 --pick 2
printf '1\n2\n' | npm run geocode japon-2024   # même chose, sur l'entrée standard
```

L'entrée standard est lue jusqu'à la fin du flux, pas à l'instant où la commande démarre :
un producteur lent (`( sleep 1; echo 1 ) | …`) est attendu, pas perdu.

**`--pick` ne rejoue pas un choix déjà écrit.** Un lieu qui a déjà son bloc `coordinates:`
n'est pas redemandé — relancer avec `--pick 2` sur un voyage complet répond « toutes les
villes ont déjà leurs coordonnées, rien à faire », et le `--pick` est ignoré. Un mauvais
numéro qui a passé la contre-vérification du pays est donc **définitif** : pour le refaire,
supprime le bloc `coordinates:` du lieu concerné dans le `trip.yaml`, puis relance.

Aucune clé d'API n'est nécessaire : le service (`geocoding-api.open-meteo.com`) n'en demande
pas. Il n'y a donc aucun secret à configurer, et rien à faire fuiter.

Les messages de `npm run validate:content` nomment le fichier, la ligne, le champ et **la
commande à lancer** :

```
content/trips/japon-2024/trip.yaml:13:5 — places[1].coordinates : la ville « Kyoto » est déclarée sans coordonnées → lance « npm run geocode japon-2024 »
```

Deux réparations ont leur commande dédiée :

| Problème               | Commande                      | État                                  |
| ---------------------- | ----------------------------- | ------------------------------------- |
| coordonnées manquantes | `npm run geocode <slug>`      | livrée (TIW-10)                       |
| dimensions de photo    | `npm run index-photos <slug>` | pas encore écrite (TIW-17), sort en 1 |

### Valider autre chose que le contenu réel

Utile pour tester la validation elle-même, sans toucher aux voyages :

```bash
npm run validate:content -- tests/fixtures/content/valid-trip/trips \
  --public tests/fixtures/content/valid-trip/public
```

En variables d'environnement : `TIW_CONTENT_DIR` et `TIW_PUBLIC_DIR`. Un argument explicite
l'emporte sur l'environnement.
