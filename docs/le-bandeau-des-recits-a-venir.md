# Le bandeau « récits à venir » : dérivé du contenu, pas déclaré

- **Statut** : tranché, appliqué par TIW-35
- **Date** : 2026-08-28
- **Portée** : le bandeau d'état du carnet, rendu par `src/app/[locale]/layout.tsx`

Ce n'est pas une ADR — `docs/adr/` consigne les décisions de structure. Celle-ci
arbitre **comment un état temporaire s'éteint sur un site entièrement prérendu**,
et elle vit ici pour la même raison que `docs/fraicheur-au-prerendu.md` : elle
doit être lisible **avant** de relire le code, et le code y renvoie.

## Le problème, énoncé

Le carnet est complet et la carte fonctionne, mais aucun voyage n'a encore de
récit. Les premiers lieux arrivent dans l'état `story: unwritten` livré par
TIW-18 — pays teinté, balise présente, pas de récit — parce que les lieux sont
connus et les dates ne le sont pas encore. Un visiteur qui découvre ça sans un
mot conclut que le site est vide ou en panne.

Il faut donc un bandeau. Or **le bandeau annonce un état temporaire, et tout est
prérendu au build** : le jour où les récits sont là, il faut qu'il parte.

## La décision : dérivé du contenu

Le bandeau s'affiche si et seulement si **aucun voyage publié n'a de récit
écrit** :

```ts
holdsNoStory(trips) === !trips.some(hasStory);
```

Un seul prédicat, `holdsNoStory` dans `src/domain/trip.ts`, à côté de `hasStory`
dont il est la négation collective. Aucun champ de contenu, aucune constante,
aucune variable d'environnement.

### Pourquoi, contre l'interrupteur explicite

**1. La cohabitation avec le bandeau « Nouveau récit » (TIW-19) devient
impossible par construction, et non par arbitrage.** C'est l'argument le plus
fort, et il n'était pas prévu : les deux bandeaux se retranchent derrière **le
même prédicat**. `freshestTrip` écarte les voyages `story: unwritten` _avant_ de
comparer — c'est écrit dans `src/domain/freshness.ts` et dans `AGENTS.md`. Donc :

- `holdsNoStory(trips)` vrai ⟹ aucun `hasStory` ⟹ `freshestTrip` répond
  `undefined` ⟹ **aucun** bandeau « Nouveau récit » ;
- un bandeau « Nouveau récit » rendu ⟹ un `hasStory` existe ⟹ `holdsNoStory`
  faux ⟹ **aucun** bandeau d'état.

Le critère d'acceptation demandait de « décider ce qui s'affiche quand les deux
sont vrais ». La réponse est meilleure qu'un arbitrage : **cet état n'existe
pas**, et `tests/app/journal-notice-pipeline.test.ts` le prouve sur trois
collections réelles. Avec un interrupteur, « les deux vrais » serait un état
atteignable — celui, précisément, où quelqu'un publie un récit sans penser à
éteindre l'interrupteur — qu'il faudrait arbitrer, styler et tester.

**2. Le précédent du dépôt est net, et il penche.** Le filtre des brouillons
(TIW-11) a été refait _fail-closed_ parce qu'une valeur par défaut ouverte
laissait fuir du contenu privé. Le badge « Nouveau » (TIW-19) est dérivé de
`publishedAt` avec l'argument écrit dans `freshness.ts` : « a flag somebody has
to tick is a flag somebody forgets to untick ». Ici l'oubli est symétrique et
plus voyant : le site annoncerait « les récits arrivent » avec dix récits en
ligne.

**3. Cette dérivation-ci n'emprunte rien à l'horloge, contrairement au badge de
TIW-19.** C'est la différence qui rend ce ticket plus simple que le précédent, et
elle mérite d'être dite parce qu'un lecteur qui connaît
`docs/fraicheur-au-prerendu.md` s'attend au contraire. `freshestTrip` prend
`today` en entrée, donc le badge survit à sa date jusqu'au build suivant, et il a
fallu un déploiement quotidien pour ramener l'erreur à 24 h. `holdsNoStory` est
une fonction de la **seule collection** : publier un récit _est_ un commit, donc
un build, donc le bandeau part dans les octets de ce build-là. Aucune fenêtre
d'erreur, aucun secret Vercel à brancher, rien à rattraper.

**4. « Un bandeau qui réapparaît tout seul » est instruit, pas contourné.** Il
réapparaît dans trois cas, et aucun n'est une surprise :

| cause                                             | réapparaît | la phrase est-elle fausse ?         |
| ------------------------------------------------- | ---------- | ----------------------------------- |
| le dernier récit écrit repasse `story: unwritten` | oui        | non — il n'y a plus de récit à lire |
| le dernier récit écrit repasse `draft: true`      | oui        | non — plus rien de publié à lire    |
| le dossier du dernier récit est supprimé          | oui        | non — idem                          |

Il n'existe **aucun** chemin par lequel il réapparaît sans qu'un auteur ait
retiré le dernier récit du carnet — et dans ce cas la phrase est redevenue vraie.
La surprise que le ticket craint est un bandeau qui **mentirait** ; celui-ci ne
peut réapparaître qu'en disant vrai. L'interrupteur, lui, peut mentir dans les
deux sens.

### Ce que la dérivation coûte, et c'est le seul point où l'interrupteur gagne

Le layout doit lire le contenu : un appel de plus à `listTripSummaries()`. La
façade mémoïse son parse pour toute la durée du build, donc **zéro lecture disque
supplémentaire** — mais le layout devient sensible à `TIW_CONTENT_DIR`, là où une
constante n'aurait rien lu. C'est un couplage réel, assumé, et il ne paie pas les
quatre arguments ci-dessus.

## « Aucun récit », défini précisément

`holdsNoStory` est vrai dans **deux** états, et c'est le cœur du ticket :

- `content/trips` vide — l'état de production au moment où ceci est écrit ;
- des voyages tous en `story: unwritten` — l'état que TIW-18 a livré, et celui
  dans lequel les quatorze premiers lieux arrivent, dates inconnues.

Le second est la raison d'être du bandeau. Un `trips.length === 0` aurait laissé
sans explication exactement le visiteur que le ticket décrit : celui qui voit des
balises sur la carte et pas un récit.

Le prédicat est écrit `!trips.some(hasStory)` et **non**
`trips.every((t) => t.story === "unwritten")`. La première forme échoue fermée si
un troisième état arrive dans `StoryState` — un état inconnu n'est pas un récit
lisible, donc le bandeau reste, donc la phrase reste vraie. La seconde échouerait
ouverte : le bandeau disparaîtrait alors qu'aucun récit n'est lisible. Même
raisonnement, même direction, que l'égalité de `hasStory`.

## Renvoyable par le visiteur ? Non — et voici le chiffrage

Un bandeau renvoyable sans JavaScript client n'a que deux formes, et **aucune ne
persiste** sur un site multi-documents prérendu :

- **`:target`** — demande une ancre. Elle écrit dans l'URL, donc une entrée
  d'historique : le bouton Retour « rouvre » le bandeau au lieu de revenir à la
  page précédente. Elle est perdue à chaque navigation, chaque page étant un
  document neuf. Et elle ajoute **un arrêt de tabulation sur chacune des pages du
  site**. Le bandeau réapparaît au premier clic sur « Tous les voyages ».
- **Case à cocher masquée** — même absence de persistance, plus un contrôle de
  formulaire annoncé « case à cocher, non cochée » pour une action qui n'est pas
  un choix, plus le même arrêt de tabulation partout.

Coût d'un renvoi : **un arrêt de tabulation × chaque page, une trentaine de
lignes de CSS, zéro persistance.** Un bandeau qu'on ferme et qui revient au clic
suivant est plus agaçant qu'un bandeau qui ne se ferme pas.

Ce qui remplace le renvoi : le bandeau est un **landmark nommé**
(`<aside aria-label>`), donc franchissable en un geste au lecteur d'écran, et il
ne contient **aucun élément focusable**, donc il est invisible à la tabulation.
C'est la version « on peut passer devant » du renvoi, sans état à persister.

## Il n'occupe pas de place au premier écran, et c'est mesuré

Le critère « il ne repousse pas la carte hors du premier écran » a été mesuré
avant d'écrire une ligne de CSS, sur le build du carnet vide :

| viewport   | bas de la figure de la carte | marge sous le pli |
| ---------- | ---------------------------- | ----------------- |
| 1152 × 800 | 715 px                       | 85 px             |
| 1280 × 720 | 696 px                       | **24 px**         |

**24 px à 1280 × 720**, et c'est ce chiffre qui a décidé la forme. Une bande
ajoutée sous l'en-tête coûte au minimum une ligne de texte plus son air — de
l'ordre de 28 à 36 px — donc elle passait à 1152 × 800, le viewport du critère de
TIW-13, et **débordait** à 1280 × 720. TIW-19 avait eu 85 px de marge pour son
bandeau ; il n'en reste pas autant.

La sortie retenue n'est donc pas de compresser la typographie jusqu'à tenir dans
24 px — 12 px de corps sur toutes les pages du site pour gagner 15 px est un
mauvais échange. Le bandeau **occupe le blanc qui existait déjà** :
`main { padding-block-start: var(--section-space) }` vaut 92 px à 1152 et 102 px à
1280, et c'est de la décoration. Une règle d'adjacence,
`.notice + main`, ramène ce blanc à `var(--space-7)` **tant que le bandeau est
là** — donc le bandeau ne crée pas de bande, il se pose dans celle qui séparait
déjà le chrome du contenu.

Deux propriétés de cette règle valent d'être sues :

- elle **s'annule d'elle-même**. Le sélecteur est une adjacence : le jour où
  `holdsNoStory` répond `false`, le bandeau n'est plus rendu, `main` n'a plus de
  voisin, et le blanc reprend sa valeur pleine. Rien à défaire.
- `--space-7` vaut `3rem`, exactement le **plancher** du `clamp()` de
  `--section-space`. Donc là où le blanc était déjà minimal — les petites largeurs
  — la règle ne retire rien, et elle ne mord que là où il était généreux. Ce n'est
  pas une coïncidence, c'est le critère qui a fait choisir ce jeton.

**Le résultat, remesuré sur le build servi une fois la règle en place** — et il est
meilleur que « ne repousse pas » :

| viewport   | sans le bandeau | avec   | delta      | hauteur du bandeau |
| ---------- | --------------- | ------ | ---------- | ------------------ |
| 1152 × 800 | 715 px          | 699 px | **−16 px** | 28 px              |
| 1280 × 720 | 696 px          | 669 px | **−27 px** | 28 px              |

Le bandeau ne coûte pas 28 px au premier écran : il **remonte** la carte de 16 et
27 px, parce que la bande qu'il occupe était plus grande que lui.

Une mesure corrigée en route, gardée ici parce qu'elle est instructive :
`.body` portait `max-width: 70ch`, copié de `.intro`. À `--text-sm` cela fait
environ 490 px, donc la phrase passait à **deux** lignes et la bande à **47 px** au
lieu de 28. Une mesure gagne sa place sur un paragraphe — elle empêche l'œil de
perdre le début de la ligne suivante — et sur une notice d'une phrase elle
n'achetait qu'une seconde ligne.

Le garde qui tient tout ça est `tests/e2e/journal-notice.spec.ts`, qui mesure le
bas de la figure aux deux viewports sur la page servie, **et** refuse un bandeau de
plus d'une ligne. Un garde et pas une note : `--space-7` est un nombre mesuré, et
un nombre mesuré sans test dérive.

Et ce que ce doc ne prétend pas mesurer : `npm run test:perf` tourne sur la fixture
**peuplée**, où le bandeau n'est pas rendu, donc il ne dit rien de lui. Le décalage
cumulé a été mesuré à part sur le build du carnet vide, aux mêmes conditions
(Pixel 5, CPU ×4, Slow 4G) : **CLS 0,0000** sur `/fr`, `/fr/voyages` et
`/fr/a-propos`. Attendu — le bandeau est du HTML serveur sans image et sans script,
donc rien ne peut arriver après la première peinture pour le déplacer — mais
attendu n'est pas mesuré.

## Ce qui est délibérément absent

- **Pas de `role="alert"`.** Le rôle interrompt le lecteur d'écran ; l'information
  est permanente et n'est pas une urgence. Pas de `role="status"` non plus : une
  région live sur des octets figés au build n'annonce jamais rien.
- **Pas de titre.** Un `<h2>`, même masqué, se poserait **avant** le `<h1>` de
  chaque page et casserait l'ordre des titres que
  `tests/e2e/heading-order.populated.spec.ts` garde. Le landmark est nommé par
  `aria-label` à la place — c'est un nom de région, pas un contenu, ce qui est la
  distinction que l'ADR 0003 fait quand elle refuse `aria-label` pour le libellé
  d'une balise.
- **Zéro octet de JavaScript.** Un `<aside>`, un `<p>`, une feuille CSS Module.
  Les deux `'use client'` du jalon sont dépensés (carte TIW-14, visionneuse
  TIW-17) et un bandeau non renvoyable n'a aucune raison d'en demander un
  troisième.

## Ce qui invaliderait cette décision

1. Un besoin d'annoncer autre chose que « il n'y a pas encore de récit » — une
   maintenance, un déménagement d'adresse. Ce serait un second bandeau avec une
   autre condition, et la mutuelle exclusion ci-dessus ne le couvrirait plus.
2. Un carnet qui garde durablement des voyages sans récit **à côté** de récits
   écrits. Le bandeau s'éteint alors alors que la moitié de la carte reste muette,
   et l'explication devrait descendre au niveau de l'entrée — ce que la mention
   « Récit à venir » de TIW-18 fait déjà, par voyage.
