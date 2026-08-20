<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Contenu projet : écrit à la main, hors des marqueurs ci-dessus.
     `next dev` ne réécrit que la région BEGIN/END, ce bloc est donc préservé. -->

# travels_in_world — à savoir avant d'écrire une ligne

Journal de voyages : une carte du monde semée de balises, chaque voyage raconté en frise
chronologique d'étapes. Contenu en fichiers versionnés, aucune base de données.

## Les trois invariants

**1. Tout est prérendu au build. C'est le pari central du projet.**
Toute lecture d'en-tête de requête **au-dessus** du segment `[locale]` — layout racine ou
`not-found.tsx` global — dé-statifie l'arbre entier, `/fr` compris. `next build` sort alors
en **code 0** avec un « ✓ Generating static pages » trompeur : aucun signal. La garde est
`npm run test:build`, qui lit `.next/prerender-manifest.json` et exige `/fr` et
`/_not-found`. Elle a été prouvée par un échec volontaire. Ne la contourne pas, ne la
désactive pas : lance-la après toute modification d'un layout, du 404 ou des métadonnées.

**2. Navigation interne : jamais `next/link` ni `next/navigation`.**
Utilise `Link`, `redirect`, `usePathname`, `useRouter` depuis `@/i18n/navigation`, sinon le
segment de locale est perdu. Une règle ESLint le refuse partout sauf dans
`src/i18n/navigation.ts`. Angle mort connu et non couvert : `await import("next/link")`.

**3. Server Components par défaut.**
Le jalon 1 n'autorise que deux composants `'use client'` : l'interaction de la carte et la
visionneuse photo. Tout autre `'use client'` se justifie en revue. `src/domain/**` reste du
TypeScript pur — ni React, ni Next, ni `fs`, ni `d3`. `src/map/**` porte
`import "server-only"` : le build casse si un composant client l'atteint. `src/content/**`
**ne le porte pas**, délibérément : c'est du code Node exécutable, que
`npm run validate:content` et Vitest chargent hors contexte React, où `server-only` jette.
Le garde appartient à la façade de chargement que consommera l'application (TIW-11), et
c'est elle qui le portera.

## Dépendances écartées, délibérément

Aucun Tailwind (CSS nu avec custom properties). Aucune bibliothèque de carte : la carte est
du SVG calculé au build par d3-geo, **0 Ko de bibliothèque côté client**. Aucun gestionnaire
d'état, aucun client HTTP ni React Query, aucune bibliothèque de formulaires, aucun
CSS-in-JS. Avant d'ajouter une dépendance, vérifie le budget : `npm run test:build` mesure
le JS initial, à **120 Ko brotli pour un plafond de 150 Ko** — il reste 30 Ko.

## Versions figées, et pourquoi

**TypeScript `~5.9.3`** : ne bump pas vers 7.x. TypeScript 7 n'expose plus l'API classique
du compilateur, ce qui casse `typescript-eslint` **et** le typecheck intégré de `next build`.
À lever quand `typescript-eslint` publiera une majeure acceptant `>=7`.
**Node 24.x** (`.nvmrc`, `engines`) pour l'alignement avec Vercel.

## Les deux gardes exécutables

Deux invariants de ce projet ne se défendent ni par le typage ni par une revue de code :
ils se cassent en silence, avec un build vert. Chacun a donc un test qui lit un artefact
réel, et chacun a été prouvé par un échec volontaire. **Ne les désactive pas.**

| Commande             | Ce qu'elle garde                                     | Ce qui se passe sans elle                     |
| -------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `npm run test:build` | `/fr` et `/_not-found` sont bien prérendus           | le prérendu disparaît, `next build` sort en 0 |
| `npm run test:lint`  | la frontière de pureté de `src/domain` mord vraiment | la règle existe et ne refuse plus rien        |

Les deux exigent une étape préalable (`test:build` a besoin d'un build) et vivent donc hors
de `npm run test`. Elles sont branchées au pipeline d'intégration continue.

Historique qui justifie la seconde : la règle de pureté a régressé **deux fois** en un seul
ticket — un glob qui ne couvrait pas les fichiers `.tsx`, puis un motif qui laissait passer
l'orthographe `./../` là où `../` était refusée. Dans les deux cas la règle existait et ne
gardait plus rien. Écrire le test a en outre révélé que trois de ses quatre motifs étaient
inutiles : `".."` couvre à lui seul les six orthographes relatives.
