# 4. La CI garde la fusion, pas le déploiement

- **Statut** : accepté
- **Date** : 2026-08-28
- **Contexte du ticket** : TIW-22 (mise en ligne sur Vercel et pipeline de vérifications)

## Contexte

Deux machines observent désormais chaque poussée : GitHub Actions, qui exécute la
chaîne de vérifications, et Vercel, qui construit et sert. Elles sont
**indépendantes** — c'est un fait de la plateforme, pas un choix. Vercel se
déclenche sur l'événement Git, pas sur le résultat d'un workflow ; il ne l'attend
pas et n'en connaît pas l'existence. Une prévisualisation est donc en ligne
pendant que le pipeline tourne encore, et le reste si le pipeline finit rouge.

Le critère d'acceptation du ticket dit qu'« un contenu invalide ou un budget
dépassé fait échouer la vérification **avant** le déploiement ». Lu naïvement,
cela demande à la CI de barrer le déploiement. Elle ne peut pas : rien dans
GitHub Actions n'a la main sur un build Vercel déjà parti.

Ce qu'elle peut faire, en revanche, est plus solide. La production ne se déploie
que depuis `main`, et on n'arrive sur `main` que par une fusion. **Bloquer la
fusion, c'est bloquer la production** — sans jamais avoir à coordonner deux
systèmes qui ne se parlent pas.

Reste un trou que ce raisonnement ne couvre pas : le build Vercel exécute
`next build`, et rien d'autre. Ni `validate:content`, ni `test:build`. Le jour où
`content/trips/` ne sera plus vide (TIW-24), un `trip.yaml` fautif poussé
directement sur `main` — correctif à chaud, fusion forcée par un administrateur —
partirait en production sans qu'aucune des deux machines ne l'ait lu.

## Décision

**La protection de branche est le point de blocage, et le seul.** Un
`pull_request` rouge rend la fusion impossible ; c'est là que vit la garantie du
ticket. Le pipeline ne tente pas d'annuler, de retarder ou de conditionner un
déploiement Vercel.

**La prévisualisation n'est pas gardée, et c'est voulu.** C'est l'endroit où se
relit un voyage en `draft` : elle doit être en ligne le plus vite possible, y
compris quand `npm run lint` se plaint d'un import mal trié. Une prévisualisation
retenue jusqu'au vert du pipeline transformerait la relecture d'un brouillon en
attente de quatre minutes, pour un gain nul — personne ne publie depuis une
prévisualisation.

> **Correction (TIW-11, audit de la frontière de publication).** Le paragraphe
> ci-dessus reste valable sur son sujet — le pipeline ne retient pas le
> déploiement — mais sa prémisse sur les brouillons était fausse au moment où il a
> été écrit, et la décision n'est pas modifiée : elle est corrigée par ajout.
>
> Mesuré : `VERCEL_ENV=preview npx next build` **masque** les brouillons, comme un
> build de production. Une prévisualisation ne montre donc rien de plus qu'une
> production tant que `TIW_DRAFTS=visible` n'est pas posé, et ce réglage demande
> deux précautions écrites dans `docs/deploiement.md` : portée `Preview`
> uniquement, et Deployment Protection activée d'abord — l'URL de prévisualisation
> est publique et Vercel la commente sur la pull request.
>
> Cette phrase avait une conséquence réelle : en promettant une relecture de
> brouillon qui n'existait pas, elle créait la pression qui fait poser la variable,
> et le formulaire de Vercel coche les trois portées par défaut. Le code refuse
> désormais ce cas (`showsDrafts()` ne peut plus publier quand `VERCEL_ENV` vaut
> `production`), et `vercel.json` lance `test:build` après le build, sur la seule
> machine où cette configuration existe.

**Le build Vercel valide le contenu lui-même.** `vercel.json` porte

```
"buildCommand": "npm run validate:content && npm run build && npm run test:build"
```

ce qui déplace la seule vérification dont dépend le rendu des pages du côté de la
machine qui sert. Trois raisons de la mettre là et pas seulement en CI :

1. Elle coûte 0,3 s mesurées, sur un build de plusieurs dizaines de secondes.
2. Elle est la seule à pouvoir échouer **sur du contenu qui n'a traversé aucune
   pull request** — c'est exactement le trou décrit plus haut.
3. Elle est dans le dépôt. Le même contrôle réglé dans le tableau de bord Vercel
   serait invisible depuis le code, non revu, non versionné, et disparaîtrait au
   prochain projet recréé.

Ce qui n'y va **pas** : `test`, `lint`. Un build de déploiement doit construire.
Faire tourner la suite complète à chaque prévisualisation ajoute des minutes à
chaque brouillon relu et ne détecte rien que la pull request n'ait déjà détecté.

> **Correction (TIW-11).** `test:build` figurait dans cette liste, au motif que le
> budget de bundle et le prérendu sont des propriétés du **code** et non de
> l'environnement. C'est vrai de ces deux-là, et faux du troisième garde que le
> même fichier porte depuis TIW-11 : **aucun voyage `draft: true` n'est prérendu**.
> Celui-là dépend de `TIW_DRAFTS`, qui vit dans le tableau de bord Vercel et
> n'existe pas sur le runner GitHub — la CI ne peut donc structurellement pas le
> vérifier pour le déploiement. `test:build` est passé dans le `buildCommand` pour
> cette raison, et pour elle seule. Coût mesuré : moins d'une seconde.

### Un seul nom de vérification requis

La protection de branche pointe sur un job d'agrégation, `verify`, dont le seul
travail est de refuser si l'un de `checks`, `build`, `e2e` n'a pas réussi.

Ce n'est pas une commodité de configuration, c'est la même classe de piège que
les deux gardes d'`AGENTS.md`. Si la protection listait les jobs un par un, le
jour où un quatrième job est ajouté il serait **consultatif** : il tourne, il
s'affiche, il peut être rouge, et la fusion passe quand même — jusqu'à ce que
quelqu'un pense à retourner cocher une case dans une interface. Un garde qui ne
garde rien tout en paraissant vert : la forme exacte de ce que ce dépôt a déjà
rencontré deux fois. Avec l'agrégat, la liste des jobs requis vit dans le
`needs:` du workflow, donc dans le dépôt, donc dans la revue.

Son `if: always()` est indispensable et contre-intuitif : sans lui, le job est
_skipped_ dès qu'une dépendance échoue, et une vérification requise ignorée est
rapportée à GitHub comme neutre — pas comme un échec. La protection laisserait
alors fusionner précisément quand quelque chose est cassé.

### Trois jobs parallèles, et `test:build` dans celui du build

`checks` (lint, types, contenu, unitaires), `build` (build + gardes de prérendu et
de budget) et `e2e` (Playwright) tournent en parallèle. Mesures locales :
~20 s pour le premier, ~7 s pour le second, ~6 s pour le troisième une fois les
navigateurs installés. En séquence, le coût serait acceptable ; en parallèle, un
échec de lint et un dépassement de budget sont rapportés **dans le même run**, au
lieu que le premier masque le second et impose un second aller-retour.

Le dépôt est public, donc les minutes GitHub Actions sont gratuites et illimitées :
le triple `npm ci` ne se paie qu'en temps de démarrage, et le cache npm
d'`actions/setup-node` l'absorbe.

`test:build` ne peut pas être un job séparé : il lit `.next/prerender-manifest.json`
et les chunks de `.next/static`. L'isoler demanderait de téléverser puis
retélécharger `.next` entre deux jobs, soit plus de secondes que le build n'en
consomme — et une occasion de mesurer un budget sur un artefact reconstitué au
lieu de l'artefact réel.

L'E2E, à l'inverse, est bien un job séparé alors qu'il pourrait être une étape de
`build`, parce que `playwright.config.ts` reconstruit tout : son `webServer` lance
`npm run build && npm run start` avec `reuseExistingServer: false`, propriété
délibérée dont le commentaire du fichier explique le prix. On paie donc deux
builds ; les mettre dans le même job les paierait en série.

## Alternatives écartées

**« Ignored Build Step » côté Vercel.** Vercel accepte une commande qui, en
sortant en code 0, annule le build. On pourrait y interroger l'API GitHub pour
connaître l'état du dernier run. Écarté : cela demande un jeton GitHub dans les
variables d'environnement Vercel (un secret à faire vivre pour une commodité),
introduit une course — le run est _pending_ à l'instant où Vercel démarre, donc la
commande devrait attendre, dans le conteneur de build, en facturant l'attente — et
supprime la prévisualisation rapide, qui est la fonctionnalité qu'on est venu
chercher.

**Déployer depuis GitHub Actions avec la CLI `vercel`.** Le pipeline construirait,
vérifierait, puis publierait un artefact unique — ce qui serait la forme
canonique : un seul build, promu, jamais reconstruit par environnement. Écarté
pour l'instant : cela demande `VERCEL_TOKEN`, `VERCEL_ORG_ID` et `VERCEL_PROJECT_ID`
en secrets, remplace l'intégration Git de Vercel (donc les prévisualisations
automatiques, les commentaires de déploiement sur la pull request, les
rollbacks en un clic) par du code à maintenir, et ne corrige aucun problème
observé. À reprendre le jour où le build de déploiement devra faire autre chose
que `next build` — un index de photos à générer, par exemple (TIW-17).

**Faire tourner toute la suite dans le `buildCommand` de Vercel.** Écarté :
double emploi avec la CI sur tout sauf le contenu, et minutes de build payées à
chaque brouillon relu.

## Conséquences

- **Une prévisualisation en ligne ne prouve rien.** Elle prouve que `next build`
  et `validate:content` passent, rien de plus. Le vert qui compte est celui de la
  pull request.
- **La garantie du ticket dépend d'un réglage hors du dépôt.** Le workflow ne
  bloque rien par lui-même : la protection de branche est ce qui transforme un run
  rouge en fusion impossible, et elle vit dans les réglages GitHub. Les commandes
  exactes sont dans `docs/deploiement.md`, à appliquer une fois — et à vérifier si
  une fusion passe un jour avec un run rouge.
- **`main` reste la branche de production, `develop` la branche d'intégration.**
  Le workflow tourne aussi sur les poussées vers ces deux branches : deux pull
  requests peuvent être vertes séparément et rouges une fois fusionnées l'une dans
  l'autre.
- **Le rollback n'est pas dans le dépôt.** Il se fait en promouvant un déploiement
  antérieur depuis le tableau de bord Vercel, pas par un `git revert` — un revert
  reconstruit, ce qui prend des minutes et peut échouer. Commande et chemin exacts
  dans `docs/deploiement.md`.

## Ce qui invaliderait cette décision

1. **Un build de déploiement qui doit faire plus que construire** — générer un
   index de photos, appeler un service. L'alternative « déployer depuis Actions »
   redevient la bonne : un artefact unique, vérifié, promu.
2. **Un contributeur autre que le propriétaire du dépôt.** Une pull request venue
   d'un fork déploie une prévisualisation avec un jeton en lecture seule et un
   cache isolé, mais la prévisualisation non gardée cesse d'être anodine dès que le
   code qu'elle sert n'a pas été écrit par la personne qui relit.
3. **Une chaîne de vérifications qui dépasse la dizaine de minutes.** Le
   parallélisme à trois jobs suffit aujourd'hui parce que la suite est rapide. Au
   delà, il faudra découper par ce qui change — et le calcul « en parallèle, tous
   les échecs dans le même run » ne tiendra plus.
