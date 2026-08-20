# travels_in_world

Carnet de voyages personnel : une carte du monde en SVG rendue côté serveur et, pour chaque
voyage, une page en frise chronologique d'étapes. Le contenu vit en fichiers versionnés
(YAML + MDX) — il n'y a pas de base de données. Déploiement sur Vercel.

## Prérequis

- Node **24.x** (`.nvmrc`, champ `engines`) — la version alignée sur le runtime Vercel.
  `nvm use` avant toute commande.
- npm (pas pnpm).

## Démarrer

```bash
npm ci
npm run dev     # http://localhost:3000 → redirige vers /fr
```

## Scripts

| Script                     | Rôle                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`              | Serveur de développement                                                  |
| `npm run build`            | Build de production                                                       |
| `npm run start`            | Sert le build de production                                               |
| `npm run lint`             | ESLint (flat config)                                                      |
| `npm run format`           | Prettier en écriture                                                      |
| `npm run typecheck`        | `tsc --noEmit`                                                            |
| `npm run test`             | Vitest, une passe                                                         |
| `npm run test:watch`       | Vitest en veille                                                          |
| `npm run test:build`       | Garde de prérendu + budget de bundle — **exige un `npm run build` avant** |
| `npm run test:e2e`         | Playwright — build + start sur un port dédié, puis `tests/e2e`            |
| `npm run validate:content` | **Non implémenté** — échoue volontairement, voir TIW-9                    |
| `npm run geocode`          | **Non implémenté** — échoue volontairement, voir TIW-10                   |
| `npm run new-trip`         | **Non implémenté** — échoue volontairement, voir TIW-9                    |
| `npm run index-photos`     | **Non implémenté** — échoue volontairement, voir TIW-10                   |

Les quatre derniers ont un nom réservé mais sortent en code 1 avec un message explicite :
un script qui existe et ne fait rien silencieusement est un piège.

## Conventions

**Internationalisation.** L'arbre de routes est bilingue dès maintenant (`/fr/...`, plus tard
`/en/...`) avec une seule langue active. Trois règles :

1. Aucune chaîne d'interface en dur, y compris dans un placeholder — tout passe par
   `src/i18n/messages/<locale>.json`.
2. Pour une route interne, on importe `Link`, `redirect`, `usePathname` et `useRouter`
   depuis `@/i18n/navigation`, **jamais** de `next/link` ni de `next/navigation` : ces
   primitives ignorent le segment `[locale]` et produisent un 404 silencieux. Le cas le
   plus vicieux est `usePathname` : celui de Next renvoie le chemin **avec** le préfixe
   `/fr`, celui de next-intl **sans** — même nom, valeur opposée, aucun avertissement.
   ESLint (`no-restricted-imports`, en `patterns` pour attraper aussi `next/link.js`) le
   refuse partout sauf dans `src/i18n/navigation.ts`. Angle mort connu et assumé :
   `await import("next/link")` est un appel, pas une déclaration d'import — la règle ne
   peut pas le voir.
3. `src/app/layout.tsx` ne rend que `{children}`. `<html lang>` et `<body>` sont émis par
   `src/app/[locale]/layout.tsx`, qui connaît la locale, et par `src/app/not-found.tsx`.

**Rendu statique.** Toutes les routes doivent rester prérendues (`○`/`●` dans la sortie de
`npm run build`, jamais `ƒ`). En dehors du segment `[locale]` il n'y a pas de locale de
requête : une lecture implicite (`getTranslations("ns")` sans locale, ou le composant `Link`
côté serveur) fait lire les en-têtes à next-intl et **bascule tout l'arbre en dynamique**.
Voir le commentaire de `src/app/not-found.tsx`. Vérifier la colonne de `npm run build` après
toute modification du 404 ou du layout racine.

Cette casse est **silencieuse** : le build sort en code 0, affiche `✓ Generating static
pages (3/3)`, et le HTML servi est identique — seul `.next/server/app/fr.html` disparaît.
`npm run test:build` est la seule vérification automatique de cet invariant : elle lit
`.next/prerender-manifest.json` et exige `/fr` et `/_not-found`. Elle exige un build avant
elle et ne le fait pas à votre place (branchée en CI par TIW-22). Le même fichier porte le
budget de charge utile de `/fr` : 1,5 Ko brotli de HTML pour un plafond de 100 Ko, 120 Ko
brotli de JS initial pour un plafond de 150 Ko — chunk `noModule` exclu, c'est le bundle de
compatibilité que jamais aucun navigateur moderne n'exécute et il vaut 35 Ko à lui seul.

**Pas de proxy ni de middleware.** La redirection `/` → `/fr` est une entrée de
`redirects()` dans `next.config.ts`. Un proxy s'exécuterait en runtime Node sur **chaque**
requête HTML, `/fr` compris, alors que `/fr` est du HTML préconstruit que le CDN sait servir
seul ; une redirection de configuration est traitée par la couche de routage de la
plateforme, et la ligne `ƒ Proxy (Middleware)` disparaît de la sortie de build. Trois
conséquences assumées :

- pas de négociation `Accept-Language` et pas de cookie `NEXT_LOCALE` (voir
  `localeCookie: false` dans `src/i18n/routing.ts` : une réponse porteuse de `Set-Cookie`
  n'est pas mise en cache par un CDN, et le cookie primerait sur l'URL sans aucune UI pour
  revenir) ;
- un chemin profond **sans** préfixe de locale (`/voyages/japon-2024`) répond **404** au
  lieu d'être redirigé vers `/fr/voyages/japon-2024`. Tous les liens internes portent leur
  préfixe, donc seules les URL tapées à la main ou tronquées par un tiers tombent là.
  La page 404 (TIW-21) doit donc rester une vraie porte de sortie : titre, explication et
  lien vers l'accueil au minimum ;
- un préfixe inconnu (`/de`) répond 404 sur place, sans réécriture vers `/fr/de`.

**Limitation connue du 404.** Il n'existe qu'un seul `src/app/not-found.tsx`, qui fige
`routing.defaultLocale`. Le jour où `en` sera actif, `/en/page-inexistante` servira donc un
404 **en français**, annoncé `lang="fr"`. Ajouter `src/app/[locale]/not-found.tsx` ne le
corrige pas : mesuré, une URL sans route correspondante part au 404 global et n'atteint
jamais la limite du segment. Le contournement par catch-all `[locale]/[...rest]` corrige la
langue mais introduit une route dynamique `ƒ` et rend `<html id="__next_error__">` — refusé.
L'alarme est le test unitaire « declares exactly one active locale » : il passe au rouge dès
qu'une seconde locale est déclarée, et son commentaire liste ce qu'il faut traiter d'abord.

**Styles.** CSS nu avec custom properties, aucun Tailwind, aucun CSS-in-JS. Un seul fichier
global, `src/styles/tokens.css`, qui porte les jetons ; le style par composant se fait en CSS
Modules à côté du composant. La palette est volontairement identique à celle du portfolio :
toute modification de couleur doit y être répercutée.

**Dépendances écartées** (délibérément, ne pas les rajouter sans ticket) : bibliothèque de
carte côté client (Leaflet, MapLibre), gestionnaire d'état (Redux, Zustand), client HTTP ou
React Query, bibliothèque de formulaires, Tailwind, bibliothèque d'icônes React
(`@tabler/icons-react` a été retirée : les icônes sont du SVG rendu au build, pas des
composants client). Avec des Server Components et un contenu
versionné, il n'y a ni état client à partager ni données à aller chercher.

**`AGENTS.md` / `CLAUDE.md`.** Générés et réécrits par `next dev` (Next 16). Ils sont
committés volontairement : les supprimer ne fait que salir l'arbre au prochain `next dev`.
Pour s'en passer, `agentRules: false` dans `next.config.ts`.

## Tests

- Vitest + Testing Library pour l'unitaire et le composant (`tests/`, `src/**/*.test.tsx`).
  `globals: true` est volontairement absent de `vitest.config.ts` : sans `vitest/globals`
  dans les `types` du `tsconfig`, un test écrit avec les globals passe au vert sous Vitest et
  casse `npm run typecheck` **et** `next build` (`TS2582`). On importe depuis `"vitest"`.
- `tests/build/` (script `test:build`, config `vitest.build.config.ts`) assère sur les
  artefacts de `.next/` : prérendu et budget de bundle. Hors de `npm run test`, qui doit
  rester rapide et sans build.
- Playwright pour l'E2E (`tests/e2e/`), lancé contre un **build de production** sur un port
  dédié (`E2E_PORT`, 3277 par défaut) avec `reuseExistingServer: false`. Les deux comptent :
  sur le port 3000 et avec la réutilisation, la suite s'accrochait au `next dev` du poste et
  passait au vert contre du HTML de développement, sans aucun build.
- `tests/setup.ts` neutralise le `localStorage` natif de Node 25, qui masque celui de jsdom.
  Ne pas le supprimer sans lire le commentaire. `tests/storage.test.ts` verrouille le
  contrat du stub (accès par propriété nommée, énumération, conversion des clés, absence de
  fuite entre tests) : un stub qui s'écarte du navigateur fait passer au vert du code qui
  casse en production.

## Déploiement

Vercel. Les en-têtes de sécurité et le cache long des assets sont dans `vercel.json`.
`output: "export"` est exclu : il désactiverait l'optimisation des images et interdirait la
route API prévue. Aucun secret n'est committé — injection au runtime uniquement.
