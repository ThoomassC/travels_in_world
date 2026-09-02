# La fraîcheur d'un badge, sur un site entièrement prérendu

- **Statut** : tranché, appliqué par TIW-19
- **Date** : 2026-09-01
- **Portée** : le badge « nouveau récit » (accueil, carte, vignette) et le flux RSS

Ce n'est pas une ADR — `docs/adr/` consigne les décisions de structure, et celle-ci
est l'arbitrage d'une contradiction locale entre un critère d'acceptation et
l'invariant 1. Elle vit ici parce qu'elle doit être lisible **avant** de relire le
code, et parce que le code y renvoie.

## La contradiction, énoncée sans l'adoucir

Le critère de TIW-19 dit : « passé 60 jours, le badge disparaît **sans aucune
intervention** ». L'invariant 1 de `AGENTS.md` dit : tout est prérendu au build, et
`docs/adr/0006` le défend par un test qui lit `.next/prerender-manifest.json`.

Les deux ne peuvent pas être vrais en même temps. Le HTML est une suite d'octets
écrite pendant `next build` ; personne ne la réécrit ensuite. Un document servi
tel quel **ne connaît pas la date à laquelle il est lu**. Si le dernier
déploiement date de 70 jours, le badge du récit publié il y a 70 jours est encore
dans les octets servis, et aucune qualité de code n'y change rien.

Donc : ou bien le critère est tenu au prix de l'invariant, ou bien il est tenu
**à la granularité du déploiement** et il faut le dire. C'est la seconde branche
qui est retenue, et le reste de cette note est l'argumentaire.

## Ce qui est fait

**La fraîcheur est calculée au build.** `publishedAt` est un champ de contenu ;
`freshestTrip(trips, today)` est une fonction pure du domaine ; `today` est une
**entrée**, lue en un seul endroit (`src/app/build-day.ts`) et injectable par
`TIW_BUILD_DATE`. Aucun composant ne lit l'horloge.

**Un déploiement quotidien rend le critère vrai à 24 h près.**
`.github/workflows/refresh.yml` appelle un Deploy Hook Vercel tous les jours à
04:17 UTC. Le pire cas devient : le badge disparaît au premier build suivant
J+60, soit au plus 24 h + la durée du build après l'échéance — au lieu de
« jamais ».

**Ce qui reste à brancher, et c'est hors du dépôt** : le secret GitHub
`VERCEL_DEPLOY_HOOK_URL`, créé dans Vercel → Settings → Git → Deploy Hooks. Tant
qu'il est absent, le workflow **ne échoue pas en rouge tous les matins** : il
s'arrête sur un message qui nomme le secret manquant et ce que son absence coûte.
Un garde qui rougit tous les jours pour une raison connue est un garde que
quelqu'un désactive.

**Et le badge dit sa date.** Le bandeau d'accueil porte un `<time datetime>` avec
la date de publication. C'est la mitigation qui compte quand la première ligne
n'est pas tenue : un badge périmé reste faux, un badge périmé **daté** laisse le
lecteur trancher lui-même. Le libellé est « Nouveau récit », pas « Cette
semaine » : la première formulation vieillit mal, la seconde ment vite.

## Les deux autres voies, et pourquoi elles sont écartées

### Une solution CSS ou HTML sans script — elle n'existe pas, et voici la mesure

Ce n'est pas une intuition, c'est une propriété du langage. **CSS n'a aucune
source d'horloge murale.** Il n'y a pas de fonction de date, pas de
`@media (date > …)`, et rien dans HTML statique qui dépende de l'instant de
lecture.

La seule primitive temporelle de CSS est la timeline d'animation, et elle a été
regardée sérieusement parce qu'elle *semble* fonctionner :

```css
/* écrit au build : durée = 60 jours, décalage = âge du récit au build */
.badge { animation: expire 5184000s linear -3456000s 1 forwards; }
@keyframes expire { to { display: none } }
```

Un `animation-delay` négatif avance bien l'animation, et `forwards` fige l'état
final. Mais **la position de l'animation au chargement vaut `|delay|`, pas
`|delay| + (temps écoulé depuis le build)`** : le décalage est un littéral figé
dans les octets, et la timeline repart de zéro à chaque ouverture de page. Un
lecteur arrivant à J+70 sur un build de J+10 voit l'animation démarrer à 10
jours, pas à 70. Il faudrait qu'il laisse l'onglet ouvert cinquante jours pour
que le badge s'efface. C'est donc l'exacte même limite que le calcul au build,
avec en prime une déclaration illisible et un `display` animé.

Les autres pistes sans script tombent pour la même raison : `<meta http-equiv>`
recharge la même page, `Cache-Control` fait re-télécharger les mêmes octets, et
faire dépendre une image du calendrier du serveur, c'est écrire du code par
requête — précisément ce que l'invariant 1 refuse, et ça ne changerait qu'une
image, pas un libellé textuel.

**Conclusion mesurable : le document statique le plus frais qu'on puisse écrire
connaît sa date de build, et rien d'autre.** C'est exactement ce que le calcul au
build exploite ; il n'y a pas de marge en dessous.

### Un troisième composant client — refusé, et pas seulement pour le budget

Il tiendrait en vingt lignes : un `'use client'` qui lit `Date.now()` après le
montage et retire le badge. Trois raisons de ne pas le poser, dans l'ordre où
elles pèsent.

1. **Il ne tient pas le critère, il le déplace.** Le badge périmé est *dans le
   HTML servi* et le reste jusqu'à l'hydratation. Un lecteur sans JavaScript le
   garde pour toujours — et la page d'accueil de ce projet est explicitement
   conçue pour être complète sans JavaScript (ADR 0003, critère de TIW-13). On
   remplacerait une erreur de granularité par un scintillement, pour la moitié du
   public seulement.
2. **Il ment sur la source de vérité.** L'horloge du lecteur n'est pas une
   horloge : un poste mal réglé fait apparaître ou disparaître le badge sans que
   rien ne le dise. La date de build est fausse *de façon bornée et connue* ;
   l'horloge cliente est fausse de façon arbitraire.
3. **Le budget.** Les deux `'use client'` du jalon sont dépensés (carte TIW-14,
   visionneuse TIW-17) et il reste 26,8 Ko brotli sur `/fr`. Un troisième îlot
   coûterait un chunk sur **deux** routes prérendues (`/fr` et `/fr/voyages`) pour
   supprimer une erreur qui n'existe que sur un site qui n'a rien publié depuis
   deux mois — c'est-à-dire un site où « le dernier récit » n'est de toute façon
   plus une information chaude.

La troisième raison suffirait ; ce sont les deux premières qui rendent la
décision indépendante du chiffre.

## Ce que le critère tient, et ce qu'il ne tient pas

| Situation                                       | Le badge est-il juste ?                    |
| ----------------------------------------------- | ------------------------------------------ |
| Un récit vient d'être publié                    | oui — la publication **est** un déploiement |
| Le déploiement quotidien tourne                 | oui, à 24 h près                            |
| Le Deploy Hook n'est pas branché, rien n'est publié depuis 60 j | **non** — le badge reste, daté |
| Le lecteur a désactivé JavaScript               | identique : rien de tout ceci n'en dépend   |

La ligne du milieu est le prix, écrit ici plutôt que tu. Elle se referme en
créant un secret ; elle ne se referme pas en écrivant du code.
