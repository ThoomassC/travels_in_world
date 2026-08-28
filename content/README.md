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

draft: false # facultatif, false par défaut : le voyage est publié — voir « Un voyage en brouillon »
```

Le minimum vital est plus court : `slug`, `title`, `startDate`, `endDate`, un lieu et une
étape. Tout le reste est facultatif.

L'exemple ci-dessus se termine sur `draft: false` — c'est la valeur par défaut, écrite ici
pour être copiée sans surprise. L'exemple portait `draft: true` : on copiait le modèle, on
remplaçait les valeurs, la validation et le build passaient au vert, et le voyage
n'apparaissait nulle part en ligne sans qu'un mot le dise. C'est précisément le mode
d'échec silencieux que ce champ existe pour rendre visible.

## Un voyage en brouillon

`draft: true` en fin de fichier, et le voyage n'est **pas publié**. Il n'apparaît nulle part
en ligne : ni sur la carte, ni dans les listes, ni dans le sitemap, et son URL répond 404.
En développement (`npm run dev`), au contraire, il est là comme n'importe quel voyage.

C'est ce qui permet d'écrire un voyage en plusieurs fois. Sans ce champ, il n'y a que deux
états : le fichier n'existe pas, ou il est en ligne à moitié écrit — et rien entre les deux.

```yaml
draft: true # visible sur localhost, absent de la production
```

Trois choses à savoir :

- **La validation reste entière.** Un brouillon est validé exactement comme un voyage
  publié : `npm run validate:content` refuse un itinéraire discontinu, une coordonnée
  manquante ou une photo sans texte alternatif, `draft: true` ou pas. Un brouillon qui ne
  serait vérifié qu'au moment de sa publication accumulerait ses fautes en silence jusqu'au
  jour où on veut le mettre en ligne — le pire moment pour les découvrir.
- **La clé est absente par défaut, pas facultative dans le code.** Ne rien écrire vaut
  `draft: false`. Il n'y a donc pas de troisième état « brouillon inconnu » à gérer.
- **`draft: "true"` entre guillemets est refusé.** C'est une chaîne, pas un booléen, et
  toute chaîne non vide est vraie en JavaScript : la clé accepterait n'importe quoi et le
  voyage disparaîtrait de la production sans un mot. Écris `true` ou `false`, sans
  guillemets.

Et la contrepartie, à savoir avant de s'y fier : **en développement, un brouillon ressemble
trait pour trait à un voyage publié.** À l'écran, rien ne le distingue — ni bandeau, ni
mention, ni style. Une seule chose le dit, et elle n'est pas dans le navigateur : une ligne
apparaît dans la sortie du serveur, à chaque lecture du contenu.

```
2 brouillons, visibles seulement ici : perou-2025, japon-2024
```

C'est le terminal où tourne `npm run dev`, pas la console du navigateur. Le champ `draft`
n'existe volontairement pas dans les données que reçoivent les pages : en production il
vaudrait `false` pour tout voyage visible, donc un `if (voyage.draft)` marcherait sur
localhost et ne s'exécuterait jamais en ligne.

### Voir ce qui sera réellement publié

`npm run build && npm run start` reste la réponse complète — c'est la production. Pour la
question courante, entre deux éditions, une variable d'environnement suffit :

| Variable             | Effet                                                        |
| -------------------- | ------------------------------------------------------------ |
| `TIW_DRAFTS=hidden`  | masque les brouillons, y compris en développement et en test |
| `TIW_DRAFTS=visible` | montre les brouillons, y compris en production               |
| non définie          | développement et test montrent, tout le reste masque         |

```bash
TIW_DRAFTS=hidden npm run dev     # le site tel qu'il sera en ligne, sans payer un build
```

Elle l'emporte sur tout le reste, et c'est le seul moyen de publier un brouillon : hors de
ces deux valeurs explicites, un environnement inconnu **masque**. Une valeur non reconnue
(`TIW_DRAFTS=oui`) est ignorée, pas interprétée : une faute de frappe ne décide pas d'une
publication.

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
