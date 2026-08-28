# 5. Le préfixe de locale est calculé sans `getPathname`

- **Statut** : accepté
- **Date** : 2026-08-28
- **Contexte du ticket** : TIW-28 (`getPathname` tire le `Link` client de next-intl)
- **Remplace** : la décision « on garde `getPathname` » de
  `docs/adr/0003-carte-svg-inerte-et-balises-html.md`, section « Ce que l'intégration
  a réellement mesuré »

## Contexte

`src/i18n/navigation.ts` déstructure les cinq primitives de navigation en une
expression :

```ts
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
```

Un Server Component qui rend une ancre nue n'a besoin que de la dernière. Mesuré
sur un vrai build de production (Next 16.3.1, next-intl 4.13.7), sur `/fr`, avec
un `<a href>` unique et le même href rendu à l'octet dans les deux cas :

```
href construit par localePathname   119,9 Ko brotli, 6 chunks
href construit par getPathname      123,7 Ko brotli, 8 chunks
```

**3,8 Ko brotli et deux chunks pour une page qui ne rend aucun lien client.** Le
chunk supplémentaire a été ouvert : il contient le composant `Link` **client** de
next-intl — `curLocale`, `linkRef`, `localeCookie`, `prefetch`, `usePathname`.

La cause est en amont, et elle n'est pas dans la déstructuration :
`navigation/shared/createSharedNavigationFns.js` importe `BaseLink.js` — un module
`"use client"` — **au niveau supérieur**, et construit `Link` et `getPathname`
dans le même appel. Atteindre l'un des cinq exports fait de `BaseLink` un point
d'entrée client pour la route, et une référence client n'est pas éliminée par
l'élagage d'arbre au motif qu'elle n'est pas utilisée.

Ce coût était déjà payé, sans que rien ne le mesure, par `src/app/not-found.tsx`
— seul appelant de `getPathname` avant ce ticket.

## Pistes écartées, chacune vérifiée sur cette branche

**Un `createNavigation` dédié n'y change rien.** Un module séparé n'exportant que
`getPathname`, avec son propre appel à `createNavigation(routing)` : 123,7 Ko et
8 chunks, à l'identique. Le `Link` est créé **à l'intérieur** de l'appel.

**Monter de version ne corrige pas.** C'était la piste la moins chère et elle a
été instruite sur le paquet publié, pas sur le journal des modifications :
next-intl **4.14.1**, la dernière version, porte le même
`import c from"./BaseLink.js"` statique dans `createSharedNavigationFns`, et sa
carte d'`exports` n'ajoute aucun sous-chemin qui séparerait les deux. **Un
rapport amont reste donc à ouvrir** — c'est un défaut d'empaquetage, pas un choix
de conception, et le correctif naturel est en amont : construire `BaseLink`
derrière un import paresseux, ou publier `getPathname` sous son propre
sous-chemin.

**Fabriquer l'URL à la main est refusé.** `` `/${locale}${tripPath(slug)}` ``
rend un `href` identique à l'octet sous la configuration actuelle
(`localePrefix: "always"`, aucun `pathnames` déclaré) — vérifié. C'est
précisément ce que l'invariant 2 du projet interdit : ça redevient faux le jour
où un `pathnames` localisé apparaît, sans que rien ne le signale, et le prochain
qui copiera le motif au fil d'un appel ne copiera pas l'alarme qui en garde
l'hypothèse.

**Resserrer le budget ne l'aurait pas attrapé.** 123,7 Ko passe le plafond de
150 Ko très largement, et c'est pour cette raison que la régression a traversé
deux jalons. Un plafond à 121 Ko l'aurait attrapée **et** aurait refusé les 3 Ko
de travail légitime suivants — un garde qui bloque du vrai travail se fait
relever, puis ne garde plus rien.

## Décision

Une fonction locale, `localePathname`, dans **`src/i18n/pathname.ts`** — donc
dans `src/i18n/**`, où l'invariant 2 exige que toute URL interne soit assemblée.
Elle transcrit le seul chemin d'exécution que cette configuration de routage
atteint dans `applyPathnamePrefix` : schéma ou href relatif rendus tels quels,
tout le reste préfixé, et la barre oblique seule absorbée par le préfixe pour que
la racine soit `/fr` et jamais `/fr/`. `compileLocalizedPathname` et
`normalizeTrailingSlash` n'ont **aucun équivalent** : en amont, on ne les atteint
qu'avec un `pathnames` déclaré.

C'est un fork d'une fonction écrite par quelqu'un d'autre, et un fork pourrit. Deux
gardes le tiennent, et aucun des deux n'est déclaratif.

**1. `tests/i18n/pathname.test.ts` — l'équivalence, pas la spécification.** Une
table de onze href est vérifiée **deux fois** : contre un littéral, puis contre le
`getPathname` réel de next-intl appelé avec cette même configuration de routage.
Le fork ne peut pas dériver sans que ce test rougisse. Prouvé par sabotage
délibéré, comme le veut ce dépôt :

| sabotage                        | ce qui rougit                                              |
| ------------------------------- | ---------------------------------------------------------- |
| `localePrefix: "as-needed"`     | 7 cas différentiels + « prefixes every locale, always »    |
| `pathnames` déclaré (1 segment) | `/fr/voyages` ≠ `/fr/decouvertes`, `/fr/a/` ≠ `/fr/a`, + 2 |

Le second sabotage est celui qui compte : l'écart mesuré est exactement le 404
silencieux que l'invariant 2 existe pour refuser.

Le prix de ce test est une entrée dans `vitest.config.ts` : next-intl atteint
`next/navigation` et `next/link` par des spécificateurs nus et sans extension,
que Turbopack résout et que le résolveur Node de Vite ne résout pas — le paquet
`next` ne publie pas de carte d'`exports` pour le faire à sa place. D'où deux
alias qui n'ajoutent que l'extension, et l'inlining de next-intl seul pour que
les alias soient vus. Documenté sur place.

**2. `tests/build/prerender.test.ts` — l'empreinte, pas le nombre.** Le garde de
build n'assertait que `/fr`, et c'est ce que ça a coûté : les 12,4 Ko dormaient
dans le bundle initial de `/_not-found`, la seule route que rien ne mesurait,
pendant que `/fr` était déclaré propre. Le budget porte désormais sur **les deux**
routes prérendues, et un garde nommé refuse la présence du `Link` client de
next-intl dans tout chunk initial de toute route prérendue — reconnu par trois
noms de propriétés, que la minification ne peut pas renommer sans changer la
forme de l'objet. Le garde garde son propre motif : il vérifie d'abord que ces
trois noms sont **réellement** dans le `BaseLink.js` de next-intl, sans quoi une
version qui les renommerait transformerait l'assertion en trois recherches qui ne
peuvent plus rien trouver, et la suite annoncerait un succès pour l'absence d'une
chaîne qui n'existe plus.

Vérifié par sabotage : `getPathname` réintroduit dans un Server Component, le
build sort en **code 0**, passe le plafond de 150 Ko, et `npm run test:build`
rougit en nommant le chunk et le remplacement à utiliser.

## Conséquences

**Ce qu'on gagne.** `/fr` passe de 120,2 Ko et 7 chunks à **119,9 Ko et
6 chunks** ; `/_not-found`, seul appelant réel avant ce ticket, de 123,5 Ko et
7 chunks à **111,1 Ko et 5 chunks** — soit **12,4 Ko**, bien plus que les 3,4 Ko
annoncés par le ticket. La différence n'est pas une erreur de mesure : `BaseLink`
importait aussi `useLocale` de `use-intl`, ce qui tirait le runtime intl client
sur une route 404 qui n'en a aucun usage. Le budget de JavaScript du jalon repasse
de 30 à 38 Ko de marge sur 150.

Et surtout, `@/i18n/navigation` porte désormais son coût en tête de fichier. La
prochaine personne à écrire `import { getPathname }` le lit avant de le mesurer.

**Ce qu'on paie.** Un fork. `localePathname` répète une logique qui vit ailleurs,
et la répétition est exacte aujourd'hui parce qu'un test le prouve, pas parce
qu'elle est évidente. Le fork a aussi une arête vive héritée d'amont : un href
sans barre oblique initiale n'est pas préfixé — il est rendu tel quel, donc 404
silencieux. Garder les appelants est le rôle de `src/i18n/paths.ts`, dont le test
épingle que `tripPath` commence toujours par `/voyages/`.

**Ce qui reste ouvert.** Le rapport amont. Et la suppression de ce module : le
jour où next-intl publie `getPathname` sans le `Link` client, on supprime
`src/i18n/pathname.ts`, on réexporte `getPathname` depuis `@/i18n/navigation`, et
on confirme par `npm run build && npm run test:build` que `/fr` reste à
6 chunks. La marche à suivre est écrite dans l'en-tête du module.
