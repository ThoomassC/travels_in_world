# 6. Tout est prérendu au build, et c'est un artefact qui le prouve

- **Statut** : accepté
- **Date** : 2026-08-31
- **Contexte du ticket** : décision prise à TIW-7 (socle applicatif), consignée
  rétrospectivement par TIW-27

## Contexte

Un journal de voyages n'a pas de session, pas de panier, pas de contenu par
lecteur. Chaque page est la même pour tout le monde et ne change qu'à
l'édition — c'est-à-dire à un commit. Le rendu à la demande n'aurait donc rien à
calculer qu'un build ne puisse calculer une fois pour toutes.

Ce n'est pas la raison pour laquelle cette décision mérite une ADR. Elle la
mérite parce que **l'invariant se casse en silence, et qu'aucun signal ordinaire
ne le montre.**

Hors du segment `[locale]`, il n'y a pas de locale de requête. Une lecture
implicite à cet étage — `getTranslations("ns")` sans locale, le composant `Link`
côté serveur, `await headers()` dans le layout racine — fait lire les en-têtes de
requête à next-intl, et Next bascule **tout l'arbre** en dynamique, `/fr`
compris. Mesuré sur Next 16.3.1 (`tests/build/prerender.test.ts`, en-tête) :

- `npm run build` sort en **code 0** ;
- il affiche un rassurant `✓ Generating static pages (3/3)` ;
- `.next/server/app/fr.html` a simplement disparu, et le manifeste de prérendu
  retombe à `['/_global-error']` ;
- le HTML servi ensuite est **identique à l'octet**.

Cette dernière ligne est celle qui décide de tout. Elle interdit les deux
vérifications qu'on penserait naturelles : aucune assertion Playwright sur la
page rendue ne peut voir la différence, et ESLint ne peut rien y faire non plus —
ce n'est pas une propriété d'un import. La colonne de statut de la sortie de
build est la version lisible par un humain de ce contrôle ; personne ne la lit à
chaque poussée.

## Décision

**Toutes les routes restent prérendues** — `○` ou `●` dans la sortie de
`npm run build`, jamais `ƒ`. Et cet invariant n'est pas défendu par une
convention de revue mais par **un test qui lit l'artefact** :
`tests/build/prerender.test.ts` ouvre `.next/prerender-manifest.json` et exige
`/fr` et `/_not-found`.

Le manifeste, et pas la sortie de build, pour une raison simple : la sortie est
du texte destiné à un œil, le manifeste est la forme lisible par une machine du
même fait.

La garde vit dans sa propre configuration Vitest et son propre script
(`npm run test:build`), donc **hors de `npm run test`**, qui doit rester sans
build. Elle échoue explicitement si `.next/` manque plutôt que de passer sur
zéro assertion.

### Trois conséquences structurelles, à ne pas défaire par distraction

Elles ne se lisent pas dans le manifeste, mais elles sont ce qui rend le
manifeste vert :

1. **Le layout racine ne rend que ses enfants.** `<html lang>` et `<body>` sont
   émis un segment plus bas, là où la locale est connue, et par le 404 global.
2. **Tout, dans `src/app/not-found.tsx`, résout la locale explicitement** —
   `getTranslations({ locale, namespace })`, et une ancre nue plutôt que `Link`.
   Une seule recherche implicite à cet endroit dé-statifie l'arbre entier.
3. **`src/i18n/request.ts` retombe sur `defaultLocale`** quand `requestLocale`
   est `undefined`, ce qui est exactement le cas hors du segment `[locale]`.

### La liste des routes est dérivée de l'artefact, jamais écrite en dur

C'est la correction que TIW-28 a apportée à cette garde, et elle vaut d'être
consignée ici parce qu'elle est la forme générale du piège. La liste des routes
budgétées était `["fr", "_not-found"]`, en dur, alors que le manifeste en
contenait trois : `/_global-error` était prérendue et gardée par **rien**. Le
trou n'avait pas été bouché, il avait été **déplacé**.

La liste vient maintenant de `Object.keys(manifest.routes)` : une liste dérivée
de l'artefact ne peut pas diverger de l'artefact. Et la garde garde son propre
mécanisme — elle refuse de passer si le manifeste rend moins de deux routes, cas
où un `describe.each` vide annoncerait un succès en n'exécutant rien.

### État mesuré sur `develop` (2306e9a), ce jour

`npm run build` puis `npm run test:build` : **21 tests verts**, quatre routes
prérendues.

| route            | statut de build | HTML brotli | JS initial brotli |
| ---------------- | --------------- | ----------- | ----------------- |
| `/fr`            | `●`             | 35,8 Ko     | 119,9 Ko          |
| `/fr/voyages`    | `●`             | 2,8 Ko      | 119,9 Ko          |
| `/_not-found`    | `○`             | 1,1 Ko      | 111,1 Ko          |
| `/_global-error` | (manifeste)     | 2,0 Ko      | 111,1 Ko          |

`/[locale]/voyages/[slug]` est prérendue elle aussi, avec zéro paramètre :
`content/trips/` est vide jusqu'à TIW-24. Les plafonds et ce qu'ils gardent
appartiennent à l'ADR 0009.

## Alternatives écartées

**`output: "export"`.** L'export statique semble la traduction littérale de cette
décision, et c'est justement pourquoi il faut dire pourquoi il n'est pas retenu.
Il désactive le pipeline d'optimisation d'images et interdit les Route Handlers,
alors qu'un build Next ordinaire prérend déjà tout ce que ce projet rend. On
paierait deux fonctionnalités — dont l'indexation de photos de TIW-17 — pour une
garantie qu'on a déjà. Écarté dans `next.config.ts`, à l'endroit où quelqu'un
irait le poser.

**Se fier à la colonne de statut de `npm run build`.** C'est la vérification que
le README demande à un humain de faire, et elle est utile ; elle n'est pas une
garde. Personne ne relit une colonne après une modification de métadonnées, et
la panne ne se voit nulle part ailleurs.

**Une assertion de bout en bout.** Écartée par la mesure et non par principe : le
HTML servi est identique à l'octet une fois l'arbre dé-statifié. Playwright
verrait passer la régression sans une ligne rouge.

**Un rendu à la demande avec revalidation (ISR).** Il n'y a rien à revalider :
la source du contenu est le dépôt, et une édition est un déploiement. L'ISR
ajouterait un cache durable à raisonner — ce qui, sur la frontière des
brouillons, a déjà coûté un brouillon servi une fois de plus après correction
(ADR 0008).

## Ce qu'on paie

**La garde exige une étape préalable que personne ne lance à sa place.** Elle
suppose un build, donc elle vit hors de `npm run test`. Elle est branchée en CI
depuis TIW-22 et dans le `buildCommand` de `vercel.json` ; jusqu'à ce
branchement, elle a été une commande qu'un humain devait taper.

**Un seul 404 global, qui fige la locale par défaut.** Il n'existe qu'un
`src/app/not-found.tsx`, et il écrit `routing.defaultLocale`. Le jour où `en`
sera actif, `/en/page-inexistante` servira donc un 404 **en français**, annoncé
`lang="fr"`. Ce n'est pas un oubli : mesuré, une URL sans route correspondante
part au 404 global et n'atteint jamais la limite du segment, donc ajouter
`src/app/[locale]/not-found.tsx` ne corrige rien. Le contournement par
catch-all `[locale]/[...rest]` corrige la langue **et** introduit une route
dynamique `ƒ`, en rendant `<html id="__next_error__">` — refusé pour cette ADR
même. L'alarme est le test unitaire « declares exactly one active locale », qui
passe au rouge dès qu'une seconde locale est déclarée.

**Le prérendu ne prouve pas que la page est juste.** Une façade que rien
n'importe traverse un build vert sans être exécutée ; l'ADR 0002 documente le
cas où un lecteur de dataset cassé l'a fait.

## Ce qui invaliderait cette décision

1. **Un besoin réellement par requête** — recherche plein texte, commentaires,
   contenu par lecteur. Le pari tombe de lui-même, et ce qu'il faudra alors
   décider n'est pas « on autorise le dynamique » mais **où passe la frontière**,
   route par route, pour que le reste de l'arbre reste prérendu.
2. **Un corpus dont le build devient trop long.** Le prérendu coûte un rendu par
   voyage à chaque déploiement. Aujourd'hui : quatre pages, 267 ms de génération.
   Le jour où ce chiffre compte, la réponse est un rendu partiel ou incrémental,
   pas un abandon du pari.
3. **Une seconde locale active.** Elle ne casse pas le prérendu, elle rend
   inacceptable le 404 en français décrit plus haut, et le contournement connu
   introduit précisément la route `ƒ` que cette ADR refuse. C'est le seul des
   trois signaux qui soit déjà planifié.
