# 7. Pas de proxy : la locale vit dans l'URL, et nulle part ailleurs

- **Statut** : accepté
- **Date** : 2026-08-31
- **Contexte du ticket** : décision prise à TIW-7 (socle applicatif), consignée
  rétrospectivement par TIW-27

## Contexte

`next-intl` propose un proxy — anciennement un middleware — dont le rôle est de
regarder chaque requête, de choisir une locale et de réécrire ou rediriger en
conséquence. C'est la voie documentée, et le dépôt l'a eue : `src/proxy.ts` a
existé, et `next.config.ts` le mentionne encore comme « ex-`src/proxy.ts`,
deleted ».

Le problème n'est pas le proxy en soi, c'est ce qu'il coûte **à un site dont
toutes les pages sont du HTML préconstruit** (ADR 0006). Un proxy s'exécute dans
le runtime Node sur **chaque** requête HTML, `/fr` comprise. Or `/fr` est un
fichier que le CDN sait servir seul. On paierait donc une invocation de fonction
serveur, sur toutes les pages, pour arbitrer une question qui n'a qu'une réponse :
il y a une seule locale active.

## Décision

**Aucun proxy, aucun middleware.** Le dépôt ne contient aucun fichier
`middleware.*` ni `proxy.*`. La seule chose qui tient leur place est une entrée
de `redirects()` dans `next.config.ts` :

```ts
async redirects() {
  return [{ source: "/", destination: `/${routing.defaultLocale}`, permanent: false }];
}
```

La destination est **dérivée** de `routing.defaultLocale`, pas écrite en dur : le
jour où la locale par défaut change, elle change ici sans qu'on y pense.

Une redirection de configuration est traitée par la couche de routage de la
plateforme, donc aucune fonction serveur n'est invoquée — et la ligne
`ƒ Proxy (Middleware)` disparaît de la sortie de build, ce qui est la façon
observable de vérifier que la décision tient.

Deux réglages de `src/i18n/routing.ts` en font partie et ne s'en séparent pas :

**`localePrefix: "always"`.** Une seule URL canonique par page. `/` redirige vers
`/fr` au lieu de servir le même contenu sous deux chemins.

**`localeCookie: false`**, pour deux raisons mesurées et écrites sur place :

1. **Le cache.** Une réponse porteuse de `Set-Cookie` n'est pas stockée par un
   CDN. `/fr` est du HTML prérendu que la plateforme sert avec un `s-maxage` d'un
   an ; avec le cookie attaché, ce cache d'un an **ne s'appliquait jamais** et
   chaque visite repassait par une fonction serveur. Ce chiffre est le
   comportement de la plateforme pour du prérendu, pas un en-tête que ce dépôt
   pose : `vercel.json` ne fixe explicitement que le cache immuable de
   `/_next/static`.
2. **L'épinglage de locale.** Le cookie prime sur `Accept-Language`, et **rien
   dans l'interface ne peut l'effacer**. Le jour où `en` sera actif, une seule
   visite sur un lien `/en/...` épinglerait le visiteur en anglais sur `/` pour
   un an, sans retour possible. Avec `localePrefix: "always"`, l'URL porte déjà
   la locale : le cookie n'ajoute rien et ne retire que du contrôle.

## Les conséquences assumées, et ce qui les garde

Elles sont quatre, et non trois — la quatrième est celle qu'un test a fallu
écrire pour formuler.

- **Pas de négociation `Accept-Language`.** Un lecteur germanophone arrivant sur
  `/` reçoit le français. Sans objet avec une seule locale active ; à
  reconsidérer avec la seconde, et c'est le signal d'invalidation n° 1.
- **Pas de cookie `NEXT_LOCALE`.** Voir ci-dessus.
- **Un chemin profond sans préfixe répond 404.** `/voyages/japon-2024` n'est pas
  redirigé vers `/fr/voyages/japon-2024`. Tous les liens internes portent leur
  préfixe — c'est l'invariant 2 du projet, et `@/i18n/navigation` le garantit —
  donc seules les URL tapées à la main ou tronquées par un tiers tombent là. Le
  corollaire est une exigence sur la page 404 (TIW-21) : elle doit rester une
  vraie porte de sortie, titre, explication et lien vers l'accueil au minimum.
- **Un préfixe inconnu répond 404 sur place.** `/de` reste `/de` et répond 404.
  **Il n'est pas réécrit en `/fr/de` — ce que faisait l'ancien middleware.** Ce
  n'est pas un détail : sans proxy, un premier segment inconnu n'est plus une
  locale à négocier, c'est juste une route inconnue.

Quatre cas de `tests/e2e/routing.spec.ts` épinglent exactement ces quatre
propriétés, et pas une de plus :

| cas                                                       | ce qu'il refuse                                |
| --------------------------------------------------------- | ---------------------------------------------- |
| `the bare root redirects to the default locale`           | la redirection disparue ou pointant ailleurs   |
| `an unknown locale prefix 404s where it stands`           | le retour d'une réécriture de locale           |
| `an unknown path under the active locale renders the 404` | un 404 qui n'annonce pas sa langue             |
| `the /fr document carries no locale cookie`               | un `Set-Cookie` qui reviendrait vider le cache |

Ils tournent contre un **build de production** (`playwright.config.ts`,
`reuseExistingServer: false`) : la redirection de locale et la carte rendue au
serveur ne se comportent pas de la même façon sous `next dev`, et tester `dev`
serait tester ce qu'on ne livre jamais.

Un unitaire complète le dispositif du côté de l'assemblage d'URL —
`tests/i18n/pathname.test.ts` exige `homePathname() === "/fr"`, avec son motif
écrit sur place : « `next.config.ts` redirects `/` to `/fr` and this must agree
with it, or the 404's way out costs a hop. » Deux sources de vérité qui doivent
dire la même chose, et un test qui les confronte.

## Alternatives écartées

**Le proxy `next-intl`, c'est-à-dire la voie documentée.** Écarté pour le coût
décrit en contexte : une fonction serveur par requête HTML, sur un site
entièrement prérendu, pour arbitrer une question à une seule réponse. Il
apporterait la négociation `Accept-Language` et la réécriture des chemins non
préfixés — les deux choses listées comme prix ci-dessus. C'est donc un échange,
pas une suppression, et il redevient le bon le jour où la négociation compte.

**Une redirection permanente (308) plutôt que temporaire.** Le code écrit
`permanent: false`, et **aucun document de ce dépôt ne dit pourquoi** — cette ADR
ne l'invente pas. Ce qu'on peut dire sans extrapoler : un 308 est mis en cache
par le navigateur de façon durable, ce qui rendrait un changement de locale par
défaut, ou un `/` servant un jour un sélecteur, très pénible à déployer. Un 307
laisse cette porte ouverte pour un coût nul sur un site qu'on visite par ses
liens internes. À trancher explicitement le jour où quelqu'un touche cette ligne.

**Servir l'accueil directement sur `/`, sans préfixe** (`localePrefix:
"as-needed"`). Écarté : la même page vivrait sous deux URL, et l'ADR 0005 a
mesuré ce que ce réglage fait au fork `localePathname` — sept cas différentiels
rouges. Une URL canonique par page est plus simple à tous les étages.

## Ce qui invaliderait cette décision

1. **Une seconde locale active.** C'est le signal principal, et il est déjà
   planifié. Dès que `en` existe, `/` doit choisir, et l'absence de négociation
   cesse d'être sans objet. Trois voies s'ouvriront alors — un proxy sur `/`
   seule, une page de sélection prérendue sur `/`, ou l'acceptation d'un défaut
   assumé — et le prix mesuré du cookie (points 1 et 2 plus haut) reste valable
   dans les trois.
2. **Un besoin de décider quoi que ce soit par requête** — un test A/B, une
   protection par mot de passe, une géolocalisation. Le middleware est l'endroit
   canonique pour ça, et l'argument « aucune fonction serveur » tombe dès qu'il
   en faut une pour autre chose.
3. **Un volume mesurable d'URL non préfixées tapées à la main ou publiées par un
   tiers.** Le 404 est acceptable parce que ce cas est supposé rare. Si des liens
   entrants sans préfixe apparaissent — un partage tronqué, une ancienne URL —
   la réécriture qu'on a refusée devient le bon remède, et une entrée de plus
   dans `redirects()` la fournit sans proxy.
