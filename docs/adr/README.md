# Décisions d'architecture

Les décisions structurelles de `travels_in_world`, une par fichier, numérotées
dans l'ordre où elles ont été **consignées**.

## L'index

| #                                                        | Décision                                                                  | Ticket d'origine |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| [0001](0001-domain-purity.md)                            | Le domaine est du TypeScript pur, et une règle ESLint le tient            | TIW-8            |
| [0002](0002-facade-serveur-gardee.md)                    | Un dossier serveur s'atteint par une façade, seule à porter `server-only` | TIW-12           |
| [0003](0003-carte-svg-inerte-et-balises-html.md)         | La carte est un SVG inerte surmonté de balises HTML                       | TIW-13           |
| [0004](0004-la-ci-garde-la-fusion-pas-le-deploiement.md) | La CI garde la fusion, pas le déploiement                                 | TIW-22           |
| [0005](0005-getpathname-sans-le-link-client.md)          | Le préfixe de locale est calculé sans `getPathname`                       | TIW-28           |
| [0006](0006-tout-est-prerendu-au-build.md)               | Tout est prérendu au build, et c'est un artefact qui le prouve            | TIW-7            |
| [0007](0007-pas-de-proxy-la-locale-est-dans-l-url.md)    | Pas de proxy : la locale vit dans l'URL, et nulle part ailleurs           | TIW-7            |
| [0008](0008-publication-des-brouillons-fail-closed.md)   | Un brouillon se masque fail-closed, et le dépôt reste public              | TIW-11, TIW-16   |
| [0009](0009-le-poids-est-un-budget-mesure.md)            | Les dépendances écartées sont gardées par un budget, pas par une liste    | TIW-7, TIW-12    |
| [0010](0010-composition-des-frontieres-d-import.md)      | Les frontières d'import se composent par répétition volontaire            | fusion de TIW-11 |

Les ADR 0006 à 0010 ont été écrites **après coup**, par TIW-27, pour des
décisions déjà prises et déjà appliquées. Leur en-tête le dit, et le ticket
d'origine ci-dessus est celui de la décision, pas celui de sa rédaction.

## Ce qu'une ADR contient ici

La forme n'est pas un gabarit imposé, c'est ce que les dix documents ont en
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
qui reste valable. Les ADR 0003 et 0004 en portent deux chacune.

Une décision entièrement remplacée garde son fichier et gagne un renvoi ; la
nouvelle porte un champ **Remplace**. C'est le cas de 0003 → 0005.

La raison est simple : le raisonnement d'hier explique du code d'aujourd'hui. Le
réécrire efface la trace de ce qui a été appris, et c'est justement cette trace
qui empêche de refaire l'erreur.

## Écrire la suivante

Numéro suivant : **0011**. Nom de fichier en minuscules sans accent,
`NNNN-titre-court.md`. En-tête :

```markdown
# N. Titre à l'affirmative

- **Statut** : accepté
- **Date** : AAAA-MM-JJ
- **Contexte du ticket** : TIW-NN (ce que le ticket faisait)
```

Toutes les ADR sont en français ; le code, les identifiants et les messages de
commit restent en anglais.
