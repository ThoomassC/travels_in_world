# 8. Un brouillon se masque fail-closed, et le dépôt reste public

- **Statut** : accepté
- **Date** : 2026-08-31
- **Contexte du ticket** : décisions prises à TIW-11 (filtre de publication) et
  TIW-16 (frontière de route), consignées rétrospectivement par TIW-27

## Contexte

`draft: true` dans un `trip.yaml` est **le seul champ de ce projet qui décide
qu'un contenu n'est pas publié**. Il échoue dans la direction qui ne dit rien :
un filtre qui lit la mauvaise variable met un voyage inachevé en ligne avec un
build vert, une suite verte et un validateur vert.

La première version de ce filtre masquait un brouillon si et seulement si
`NODE_ENV` valait exactement `"production"`, et publiait pour **toute autre
valeur**. Trois faits mesurés expliquent pourquoi c'était à la fois sans
conséquence immédiate et inacceptable :

| fait                                                                   | d'où il vient                   |
| ---------------------------------------------------------------------- | ------------------------------- |
| une `NODE_ENV` pré-posée **survit** à `next build`                     | `next/dist/bin/next:84`         |
| `process.env.NODE_ENV` est **replié** en `"production"` dans le bundle | `next/dist/build/define-env.js` |
| `NEXT_PHASE=phase-production-build` est posé et **non replié**         | `next/dist/build/index.js:1212` |

La fuite ne se reproduisait donc pas **à travers `next build`** : le bundler
remplaçait la lecture par un littéral. Mais cette garantie était **empruntée à un
détail d'implémentation de Next**, et elle ne couvrait aucun consommateur non
bundlé — Vitest aujourd'hui, et demain le premier script Node qui appellera
`loadTrips()` pour un plan de site, un flux ou l'indexation des photos. Elle ne
couvrait pas non plus `next build --debug-prerender`, qui pose
`NODE_ENV=development`.

## Décision

### 1. Le filtre est un allowlist, jamais une négation

`showsDrafts()` (`src/content/loader.ts`) est lu **à chaque appel** — un
changement entre deux appels change la réponse au lieu de servir un verdict
périmé — et répond dans cet ordre :

```ts
if (asked === "visible") return process.env.VERCEL_ENV !== PRODUCTION_ENVIRONMENT;
if (asked === "hidden") return false;
if (process.env.NEXT_PHASE === PRODUCTION_BUILD_PHASE) return false;
return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
```

La dernière ligne est le cœur : une **égalité positive sur deux valeurs**. Toute
autre valeur de `NODE_ENV`, connue ou non, masque. Ne pas « simplifier » ceci en
`NODE_ENV !== "production"` ni en `NODE_ENV !== "development"` : ce serait
revenir à une valeur par défaut ouverte sur le seul champ de ce projet qui décide
qu'un contenu est privé.

Sous Vitest, `NODE_ENV` vaut `"test"`, donc **les brouillons restent visibles
dans la suite, par conception** : un test qui veut le comportement de production
le dit. Une façade qui masquerait sous « pas en développement » rendrait toute la
suite aveugle aux brouillons qu'elle est censée éprouver.

### 2. La dérogation explicite est plafonnée, et le plafond est tout l'intérêt

`TIW_DRAFTS=hidden` est **absolu** : demander moins ne peut jamais fuiter. C'est
ainsi qu'un auteur voit en local ce qui sera réellement en ligne sans payer un
build.

Demander **plus** est plafonné par `VERCEL_ENV !== "production"`. Mesuré avant ce
plafond : `TIW_DRAFTS=visible VERCEL_ENV=production npx next build` prérendait le
brouillon et écrivait son titre dans le HTML — la réponse explicite primait sur
`NEXT_PHASE` _et_ sur `VERCEL_ENV`.

Ce qui rend ce cas probable plutôt que théorique, c'est le formulaire de Vercel :
son ajout de variable coche **Production, Preview et Development par défaut**.
Une variable posée une fois pour relire un brouillon sur une prévisualisation le
publiait donc aussi sur le site en ligne, avec une CI verte et rien à remarquer.
Mesuré après correction, à travers la façade :

```
TIW_DRAFTS=visible VERCEL_ENV=production -> ["japon-2024"]
TIW_DRAFTS=visible VERCEL_ENV=preview    -> ["japon-2024","perou-2025"]
TIW_DRAFTS=visible VERCEL_ENV absent     -> ["japon-2024","perou-2025"]
aucune dérogation, build de production   -> ["japon-2024"]
```

**Une dérogation qui peut publier la production n'est pas une dérogation, c'est
un interrupteur.** `VERCEL_ENV` est le seul nom qui distingue les trois
déploiements, il est posé par la plateforme et non par nous, et il est absent
partout ailleurs — le plafond ne coûte donc rien en local ni dans la suite.

À noter, parce que la forme n'est pas homogène : cette clause-là est une
**négation** (`!== "production"`), donc ouverte sur toute valeur inconnue de
`VERCEL_ENV`. C'est assumé — la variable a trois valeurs, posées par la
plateforme — mais ce n'est pas garanti par la forme comme l'est la clause finale.

### 3. `dynamicParams = false` est ce qui rend le 404 réel

C'est la moitié que le filtre ne fournit pas, et la formulation d'origine était
fausse : **être absent de `generateStaticParams` n'est pas, en soi, un 404.**
Sous les défauts de l'App Router, un slug non retourné est _rendu à la demande_.
Mesuré sur un build qui avait correctement exclu un brouillon :

- `prerender-manifest.json` porte
  `dynamicRoutes["/[locale]/voyages/[slug]"]` avec `"fallback": null,
"compute": "blocking"` — un slug inconnu atteint une fonction serveur, pas un
  404 statique ;
- `page.js.nft.json` **trace le `trip.yaml` du brouillon dans le bundle de cette
  fonction**, donc le fichier part vers le runtime de production ;
- `process.env.TIW_DRAFTS` survit dans le chunk serveur compilé comme une lecture
  **d'exécution** (seul `NODE_ENV` est replié), donc la décision de publier est
  prise par requête, par une fonction qui a le brouillon sous la main.

Avec la variable posée à l'exécution seulement, l'URL répondait **200** avec le
contenu du brouillon. Et la retirer ne dépubliait pas aussitôt : la première
requête suivante servait encore le brouillon depuis le cache ISR
(`x-nextjs-cache: STALE`) avant que la revalidation de fond n'écrive le 404. Sur
Vercel, ce cache est durable et servi par le CDN.

D'où la ligne, sur `src/app/[locale]/voyages/[slug]/page.tsx` :

```ts
export const dynamicParams = false;
```

Vérifié : la même requête répond alors **404** avec `x-nextjs-cache: HIT`, et ne
crée **aucune** entrée de cache — pas de fonction, pas de lecture de disque, pas
de décision par requête. Vérifié aussi de bout en bout à TIW-16, contre une
fixture de deux voyages hors du dépôt, un publié et un `draft: true` :

```
next build             -> ● /fr/voyages/japon-2024, et rien d'autre
/fr/voyages/japon-2024 -> 200, la page
/fr/voyages/perou-2025 -> 404   (le brouillon)
/fr/voyages/inexistant -> 404
```

### 4. Le dépôt est public, et `draft: true` ne masque que le rendu

C'est une décision, pas une conséquence, et elle appartient à Thomas :
`ThoomassC/travels_in_world` est **public**, choix assumé.

Donc `draft: true` masque le **site rendu** et pas la **source**. Dès qu'un
brouillon est poussé, son `trip.yaml` est lisible en clair par n'importe qui sur
`raw.githubusercontent.com` — titre, itinéraire, dates, budget — et les photos de
`public/photos/<slug>/` avec lui. Fusionner ne referme rien : l'historique Git
garde ce qui y est entré, même après suppression du fichier.

Corollaire, écrit dans `content/README.md` et repris ici parce que c'est la
conséquence la plus facile à oublier : **`draft: true` est un outil de mise en
page — « pas encore fini » — et non une protection.** N'écrire dans `content/`
que ce qu'on accepterait de voir lu aujourd'hui.

Le cas des photos est arbitré dans le même sens et explicitement : les photos
d'un brouillon sous `public/photos/<slug>/` sont servies en **200** en production
pendant que sa page répond 404. Aucun garde n'a été posé contre ça, parce que ces
mêmes images sont déjà lisibles dans le dépôt.

## Alternatives écartées

**Ne pas avoir de champ `draft` du tout** — un brouillon vit sur une branche
jusqu'à publication. C'est la voie qui rend la question sans objet, et elle est
cohérente avec un contenu versionné. Écartée parce qu'elle interdit ce qui fait
l'intérêt du champ : écrire un voyage en plusieurs séances, sur `main`, en voyant
le site se remplir. Le prix en est la présente ADR.

**Un dossier `content/drafts/` hors du périmètre de lecture.** Plus simple à
raisonner qu'un champ, et sans filtre d'environnement du tout. Écartée parce
qu'elle déplace la publication d'un champ vers un `git mv` — donc hors du fichier
qu'on est en train d'écrire — et parce qu'elle ne masque pas davantage la source
sur un dépôt public.

**Se fier à `NODE_ENV` seul.** L'état d'origine, décrit en contexte. Écarté par la
mesure : la garantie était empruntée au repliement de variable du bundler, donc
absente de tout consommateur non bundlé.

**Poser le garde dans le tableau de bord Vercel** plutôt que dans le code. Même
argument que l'ADR 0004 sur `validate:content` : un contrôle réglé dans une
interface est invisible depuis le dépôt, non revu, non versionné, et disparaît au
prochain projet recréé.

## Ce qu'on paie, et ce qui reste ouvert

**La garantie dépend d'une variable qui vit hors du dépôt.** `TIW_DRAFTS` est
posée dans le tableau de bord Vercel. C'est précisément pourquoi `test:build`
figure dans le `buildCommand` de `vercel.json` et pas seulement en CI : le runner
GitHub n'a pas cette variable, et **la seule machine qui puisse constater qu'un
brouillon part en ligne est celle qui construit le déploiement**. Coût mesuré :
moins d'une seconde. Le raisonnement complet est dans l'ADR 0004, qui porte deux
notes de correction sur ce sujet.

**Ce que les tests couvrent.** `tests/content/loader.test.ts` porte 15 cas sur le
filtre — dont un `it.each` sur `TIW_DRAFTS` face à l'environnement et à la phase,
et un autre sur le plafond `VERCEL_ENV` — plus 7 cas sur le libellé de
l'avertissement en `stderr`. `tests/build/drafts.test.ts` porte 3 cas qui lisent
`.next/prerender-manifest.json` et refusent qu'un slug `draft: true` figure dans
`routes` ou dans `dynamicRoutes`. Les unitaires prouvent que le filtre répond
juste quand on l'interroge ; seul le manifeste dit ce qui a réellement été écrit
pour qu'un CDN le serve.

**Ce qu'aucun test ne couvre, et c'est un trou réel.** `dynamicParams = false`
est décrit dans son propre commentaire comme « load-bearing » et comme « la
frontière de publication », et **rien ne l'assère** : `grep -rn "dynamicParams"
tests/` ne rend aucun résultat. `tests/build/drafts.test.ts` ne peut pas
structurellement l'attraper — sa détection cherche un slug de brouillon comme
segment d'une clé du manifeste, or la clé dynamique est
`/[locale]/voyages/[slug]` et ne contient aucun slug. Supprimer cette ligne
laisserait donc la suite verte, y compris avec un brouillon sur disque. C'est
exactement la forme de panne que les quatre gardes de ce dépôt existent pour
refuser, et elle est aujourd'hui présente sur la moitié route de cette décision.
Le garde manquant est à écrire ; il n'appartient pas à un ticket de
documentation.

Aujourd'hui l'exposition est nulle — `content/trips/` ne contient qu'un
`.gitkeep`, donc le balayage est vide et il n'existe aucun brouillon. Ce trou
devient réel avec TIW-24.

## Ce qui invaliderait cette décision

1. **Le dépôt passant en privé.** La réserve du point 4 tomberait, et `draft:
true` redeviendrait une vraie frontière de publication plutôt qu'un outil de
   mise en page. C'est le seul signal qui _élargirait_ la portée de la décision
   au lieu de la casser.
2. **Un besoin de relire un brouillon avec quelqu'un d'autre.** Il se traite
   aujourd'hui par `TIW_DRAFTS=visible` sur la portée `Preview` **et** la
   Deployment Protection activée d'abord — une URL de prévisualisation est
   publique, et Vercel la commente sur la pull request d'un dépôt public
   (`docs/deploiement.md`). Le jour où cette relecture devient régulière, le
   dispositif à deux réglages manuels n'est plus le bon.
3. **Un consommateur Node non bundlé du contenu** — plan de site, flux, index de
   photos (TIW-17). Le filtre est déjà conçu pour eux, mais aucun ne l'exerce
   encore : c'est un allowlist dont la raison d'être n'a pas de témoin. Le
   premier de ces scripts devrait arriver avec un test qui vérifie qu'il ne
   publie pas de brouillon.
4. **Un `VERCEL_ENV` à plus de trois valeurs, ou un changement de plateforme.**
   Le plafond de la dérogation est une négation sur un nom posé par Vercel. Il
   faudrait alors le réécrire en allowlist, comme la clause finale.
