# Décisions d'architecture

Les décisions structurelles de `travels_in_world`, une par fichier, numérotées
dans l'ordre où elles ont été **consignées**.

## L'index

| #                                                         | Décision                                                                  | Ticket d'origine |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| [0001](0001-domain-purity.md)                             | Le domaine est du TypeScript pur, et une règle ESLint le tient            | TIW-8            |
| [0002](0002-facade-serveur-gardee.md)                     | Un dossier serveur s'atteint par une façade, seule à porter `server-only` | TIW-12           |
| [0003](0003-carte-svg-inerte-et-balises-html.md)          | La carte est un SVG inerte surmonté de balises HTML                       | TIW-13           |
| [0004](0004-la-ci-garde-la-fusion-pas-le-deploiement.md)  | La CI garde la fusion, pas le déploiement                                 | TIW-22           |
| [0005](0005-getpathname-sans-le-link-client.md)           | Le préfixe de locale est calculé sans `getPathname`                       | TIW-28           |
| [0006](0006-tout-est-prerendu-au-build.md)                | Tout est prérendu au build, et c'est un artefact qui le prouve            | TIW-7            |
| [0007](0007-pas-de-proxy-la-locale-est-dans-l-url.md)     | Pas de proxy : la locale vit dans l'URL, et nulle part ailleurs           | TIW-7            |
| [0008](0008-publication-des-brouillons-fail-closed.md)    | Un brouillon se masque fail-closed, et le dépôt reste public              | TIW-11, TIW-16   |
| [0009](0009-le-poids-est-un-budget-mesure.md)             | Les dépendances écartées sont gardées par un budget, pas par une liste    | TIW-7, TIW-12    |
| [0010](0010-composition-des-frontieres-d-import.md)       | Les frontières d'import se composent par répétition volontaire            | fusion de TIW-11 |
| [0011](0011-la-table-iso-hors-des-facades.md)             | La table ISO 3166-1 vit à la racine de `src/`, hors de toute façade       | TIW-29           |
| [0012](0012-deux-renoncements-du-prerendu.md)             | Le prérendu se paie en deux renoncements : le 410 et l'image par voyage   | TIW-21           |
| [0013](0013-la-marque-est-faite-de-fichiers-committes.md) | La marque est faite de fichiers committés, et on en vérifie les octets    | TIW-23           |
| [0014](0014-les-derivees-d-images-sont-versionnees.md)    | Les dérivées d'images sont versionnées, pas construites                   | TIW-17           |
| [0015](0015-un-artefact-genere-traverse-une-frontiere.md) | Un artefact généré traverse une frontière qu'un import ne peut pas        | TIW-30           |

Les ADR 0006 à 0010 ont été écrites **après coup**, par TIW-27, pour des
décisions déjà prises et déjà appliquées. Leur en-tête le dit, et le ticket
d'origine ci-dessus est celui de la décision, pas celui de sa rédaction. Les ADR
0011 à 0013 le sont aussi, par TIW-32, pour les décisions de TIW-21, TIW-23 et
TIW-29 — dont les auteurs avaient chacun signalé qu'elles méritaient une ADR
hors de leur périmètre. Les ADR 0014 et 0015 le sont par TIW-33, pour deux
décisions du même jour — TIW-17 et TIW-30 — dont chacune a été prise dans le
code et dans un commentaire, et nulle part dans un document qu'on relit avant de
la défaire.

## Ce qu'une ADR contient ici

La forme n'est pas un gabarit imposé, c'est ce que les quinze documents ont en
commun :

- **le contexte réel**, pas une généralité — l'état du code, le ticket, la mesure
  qui a fait poser la question ;
- **la décision**, et les propriétés non évidentes qui la rendent vraie ;
- **les alternatives réellement pesées**, avec la raison de leur rejet. Une
  alternative écartée sans raison écrite est une alternative qui reviendra ;
- **les conséquences assumées**, y compris ce qu'on paie ;
- **ce qui invaliderait la décision** — la section qui distingue une ADR d'une
  justification. Une décision sans condition de révision est un dogme.

Deux exigences valent plus que la forme :

**Quand une mesure existe, elle figure avec son chiffre.** Un ADR de ce dépôt
préfère « 119,9 Ko brotli sur 6 chunks » à « léger ». Et quand une décision n'est
pas chiffrée, l'ADR le dit plutôt que d'avancer un nombre.

**Quand une décision a un garde exécutable, l'ADR le nomme.** `npm run test:lint`,
`npm run test:build`, un fichier de test précis. Les invariants de ce projet se
cassent en silence avec un build vert ; une décision que rien n'exécute n'est
qu'une intention.

## Comment on corrige une ADR

**Par ajout, jamais par réécriture.** Une décision qui s'est révélée fausse, ou
dont une prémisse ne tenait pas, reçoit une **note de correction** encadrée à
l'endroit concerné, qui dit ce qui était faux, ce qui a été mesuré depuis, et ce
qui reste valable. Les ADR 0002, 0003 et 0004 en portent deux chacune.

Les deux notes de l'ADR 0003 sont d'une espèce un peu différente et valent d'être
lues pour ça : datées de TIW-14, elles consignent une prédiction qui s'est
**réalisée**, et que la décision a **encaissée**. Une décision jamais éprouvée
n'apprend rien ; une décision qui rencontre le signal qu'elle avait elle-même
nommé, et qui tient, dit exactement ce qui la rendait solide — ici, que le dessin
traverse la frontière client en `children` déjà rendus.

L'ADR 0002 en porte désormais une de la même espèce, datée de TIW-33 : son
troisième signal d'invalidation s'est produit, la frontière n'a pas bougé, et la
moitié instructive est que le signal désignait le mauvais consommateur. Une
prédiction qui se réalise **de travers** enseigne davantage qu'une prédiction
juste — c'est pourquoi ces notes disent toujours ce que le signal annonçait de
faux.

> **Correction (TIW-32).** Ce paragraphe disait « les ADR 0003 et 0004 en portent
> deux chacune ». C'était faux au moment où il a été écrit : l'ADR 0003 n'en
> portait alors **aucune**, et les deux du couple étaient 0002 et 0004. Compté
> plutôt que relu.

> **Correction (TIW-33, 2026-09-01).** Le compte a de nouveau bougé, et cette
> phrase ne dit plus la vérité non plus. Recompté sur le dossier — en incluant
> les notes indentées dans une liste, que le premier comptage avait manquées :
> **0002 en porte trois**, 0003 deux, 0004 deux, 0011 deux et 0009 une. Cinq ADR
> sur quinze, dix notes en tout. Le constat qu'appelle la troisième reprise de
> ce paragraphe : un compte écrit en prose se périme à chaque ticket, et il n'y a
> ici rien qui l'exécute. Le laisser comme repère de lecture, pas comme un fait.

Une décision entièrement remplacée garde son fichier et gagne un renvoi ; la
nouvelle porte un champ **Remplace**. C'est le cas de 0003 → 0005.

La raison est simple : le raisonnement d'hier explique du code d'aujourd'hui. Le
réécrire efface la trace de ce qui a été appris, et c'est justement cette trace
qui empêche de refaire l'erreur.

## Écrire la suivante

Numéro suivant : **0016**. Nom de fichier en minuscules sans accent,
`NNNN-titre-court.md`. En-tête :

```markdown
# N. Titre à l'affirmative

- **Statut** : accepté
- **Date** : AAAA-MM-JJ
- **Contexte du ticket** : TIW-NN (ce que le ticket faisait)
```

Toutes les ADR sont en français ; le code, les identifiants et les messages de
commit restent en anglais.
