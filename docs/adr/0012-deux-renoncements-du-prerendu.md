# 12. Le prérendu se paie en deux renoncements : le 410 et l'image par voyage

- **Statut** : accepté
- **Date** : 2026-09-01
- **Contexte du ticket** : TIW-21 (liens durables — canoniques, redirections,
  adresses retirées, fichiers pour robots), consignée par TIW-32
- **Complète** : `docs/adr/0006-tout-est-prerendu-au-build.md`, dont elle donne
  le premier prix payé en **fonctionnalité** et non en outillage

## Contexte

L'ADR 0006 pose le pari : toutes les routes prérendues, `○` ou `●`, jamais `ƒ`.
Jusqu'à TIW-21, ce pari n'avait coûté que de la discipline — un layout racine
qui ne rend que ses enfants, un 404 qui résout sa locale explicitement, une
garde qui lit un manifeste.

TIW-21 est le premier ticket où il coûte deux choses que le critère
d'acceptation demandait nommément : un code de statut 410 sur une adresse
retirée, et une image de partage générée par voyage. Les deux ont été
construites, mesurées, puis retirées. Sans cette ADR, chacune se relit comme un
oubli — et la première chose qu'un lecteur ferait serait de les refaire.

Les deux sont dans le même document parce qu'elles ont la même forme : une
fonctionnalité que Next sait rendre, mais **seulement à la demande**, sur une
URL qui n'a rien à calculer.

## Décision

### Un. Une adresse retirée répond 200 avec `noindex, follow`, pas 410

Mesuré sur Next 16.3.1, et c'est ce qui distingue un renoncement d'une paresse :

- Next porte **404**, **401** et **403** sur un document prérendu — `notFound()`,
  `unauthorized()`, `forbidden()` — et n'expose **rien** pour 410.
- Un Route Handler, lui, sait rendre 410, et cesse d'être prérendu à l'instant
  où il le fait : **le même handler sort `○` en rendant 200 et `ƒ` en rendant 410.**
- Le fichier `.meta` que Next écrit à côté d'un corps prérendu porte bien un
  champ `status` — qu'il refuse de remplir avec autre chose que 200.

Un vrai 410 coûte donc une fonction serveur sur une URL qui n'a aucun contenu à
calculer. C'est l'invariant 1 échangé contre trois chiffres.

Ce qui est livré à la place tient tout le reste du critère : l'adresse résout,
la page dit que le récit n'est plus en ligne, et elle propose la carte et les
trois derniers voyages — la différence entre une impasse et une redirection
d'attention. Et elle porte `noindex, follow`, qui est **ce qui retire réellement
une page d'un index**, là où un 410 est une _demande_ de le faire.

Le `noindex` ne supprime pas la canonique, et c'est délibéré : les deux
répondent à des questions différentes. `noindex` dit « ne liste pas ceci » ; la
canonique dit « cette URL est l'adresse de ce qui est ici ». Une page retirée
qui perdrait sa canonique laisserait un robot traiter une variante à
`?utm_source=…` comme une seconde page.

Un 410 authentique reste souhaitable, et il a un ticket : **TIW-31**. Deux
formes y sont possibles — une règle de plateforme dans `vercel.json`, ou le jour
où Next exposera une interruption `gone()` avec un document prérendable.

### Deux. Aucune image de partage n'est générée par voyage

Un `opengraph-image.tsx` a été construit sous le segment `[slug]` et pesé. Trois
constats, par gravité croissante.

**1. Sans `generateStaticParams`, la route sort `ƒ`** —
`ƒ /[locale]/voyages/[slug]/opengraph-image`, soit une fonction serveur par lien
partagé. Refusé par l'ADR 0006 sans autre discussion.

**2. Avec `generateStaticParams`, la colonne de build affiche `●` — et elle
ment.** C'est le constat le plus transférable des trois. Aucun PNG n'est écrit
sous `.next/server/app`, aucune paire `.body`/`.meta` n'existe pour aucun slug,
et `prerender-manifest.json` range la route sous `dynamicRoutes` avec
`fallback: null`, sans **aucune** des images concrètes sous `routes`. L'image est
donc calculée à la demande puis mise en cache.

La conséquence est que la seule garde du projet est aveugle à cette route :
`npm run test:build` dérive sa liste de `manifest.routes`, précisément pour ne
jamais écrire une liste en dur (ADR 0006). Une route qui n'apparaît que sous
`dynamicRoutes` n'est ni pesée ni comptée. Et elle l'est _parce que_ la colonne
lisible par un humain a l'air correcte : c'est la forme exacte de l'invariant 1
— un build vert pendant que la garantie a disparu — déplacée du prérendu vers la
garde du prérendu elle-même.

Le manifeste sait pourtant faire la différence, et le dépôt s'en sert déjà
ailleurs : `tests/build/drafts.test.ts` lit l'entrée de la route de voyage et
exige `fallback: false`, qui est l'orthographe au niveau de l'artefact de
`dynamicParams = false`. Mesuré dans ce test :

```
avec    dynamicParams = false  ->  { fallback: false }
sans                           ->  { fallback: null, compute: "blocking" }
```

La route d'image mesurait `fallback: null`. Elle était, à la lettre du
manifeste, une route rendue à la demande.

**3. Et la fuite qui tranche.** L'image étant rendue à la demande, elle se
trouve **hors** de la frontière de publication que `dynamicParams = false` ferme
sur la page. Mesuré contre `next start`, avec un voyage `draft: true` présent :

```
/fr/voyages/<brouillon>                    ->  404
/fr/voyages/<brouillon>/opengraph-image    ->  200, PNG de 20,6 Ko
                                               portant le titre du brouillon
```

C'est l'ADR 0008 — le brouillon se masque fail-closed — mise en échec par une
route que personne n'avait pensée comme une frontière de publication. Le titre
d'un récit non publié partait dans une carte de partage, avec la page
correspondante en 404.

Et le correctif évident n'en est pas un : poser `dynamicParams = false` sur la
route d'image ne corrige rien. Mesuré, elle répond alors **404 pour tous les
slugs**, publiés compris.

Ce qui est livré à la place est le chemin simple : la photo de couverture
déclarée, sinon la première photo du voyage. Depuis TIW-23, un voyage sans
photographie retombe sur l'image de marque du site — voir l'ADR 0013, qui
consigne le PNG committé et la raison pour laquelle c'est un fichier et non une
route.

## Alternatives écartées

**Un 410 par Route Handler.** Mesurée : `ƒ`. Le pari de l'ADR 0006 se refuse
route par route, y compris quand c'est un critère d'acceptation qui le demande.

**Un 410 par une règle de plateforme, dans `vercel.json`.** Non écartée :
reportée à TIW-31. Ce qu'il faudra peser ce jour-là est écrit d'avance — la
règle sortirait le comportement du code applicatif pour le mettre dans un
fichier de configuration de déploiement, où aucun test de ce dépôt ne le lit, et
il faudrait tenir la liste des slugs retirés à deux endroits.

**`notFound()` sur une adresse retirée.** C'est ce que le code faisait avant
TIW-21, et ce n'est pas un renoncement mais une régression de sens : un 404 dit
au lecteur qu'il a mal recopié le lien. Le lecteur d'une histoire retirée avait
la bonne adresse.

**`opengraph-image` avec `generateStaticParams`.** Mesurée : le `●` ment, aucun
fichier n'est écrit, la garde ne pèse rien.

**`opengraph-image` avec `dynamicParams = false`.** Mesurée : 404 pour tous les
slugs, publiés compris.

**Un rastériseur au build, écrivant de vrais fichiers dans `public/`.** C'est la
seule forme qui donnerait une image par voyage **et** garderait toutes les
routes prérendues. Elle n'est écartée par aucune mesure : elle n'a simplement
pas été faite, et le commentaire de `shareImageOf` la note comme la suite qui
vaut un ticket. Aucun ticket ne la porte à ce jour, et aucun chiffre n'est
disponible sur ce qu'elle coûterait en temps de build.

## Ce qu'on paie

**Le critère d'acceptation de TIW-21 n'est pas satisfait à la lettre.** Il
demande 410, la page répond 200. C'est écrit ici, dans le fichier du composant
et dans le README, plutôt que présenté comme fait.

**Un consommateur qui lit le code de statut et rien d'autre voit une page
vivante.** Le `noindex` est une balise : un moteur d'indexation la lit, un
script qui vérifie des liens en `HEAD` ne la lit pas. C'est le vrai résidu du
renoncement, et il est petit — mais il est réel, et il disparaîtra avec TIW-31.

**Deux voyages sans photographie partagent la même image.** C'est un compromis
de la marque et non du prérendu ; l'ADR 0013 l'assume à son tour.

**La garde du prérendu ne voit pas une route qui n'a pas d'entrée sous
`routes`.** C'est vrai aujourd'hui, et ce n'est pas gardé : `test:build` exige
`/fr` et `/_not-found`, dérive ses budgets de `routes`, et ne refuse rien à une
route qui n'apparaîtrait que sous `dynamicRoutes`. Seul
`tests/build/drafts.test.ts` regarde ce côté du manifeste, et il ne regarde
qu'une route, celle du voyage, pour y vérifier `fallback: false`. Une seconde
route à la demande réintroduirait exactement le trou décrit au constat 2.

## Ce qui invaliderait cette décision

1. **Next exposant un `gone()` prérendable**, ou un `status` que le `.meta`
   accepte de porter. Le premier renoncement tombe de lui-même, et TIW-31
   devient une ligne plutôt qu'un choix d'architecture.
2. **Un rastériseur au build.** Il rend le second renoncement caduc sans toucher
   au pari : des PNG réels sur le disque, pesés par `test:build` comme n'importe
   quel autre octet, et fermés par la même liste de slugs que les pages. C'est
   la seule évolution qui redonne une image par voyage sans rouvrir la fuite du
   constat 3.
3. **Une garde qui refuserait toute route sous `dynamicRoutes` sans
   `fallback: false`.** Elle n'existe pas ; le jour où elle existe, le constat 2
   cesse d'être un piège et redevient une simple contrainte, et
   `opengraph-image` pourra être reconsidéré au vu d'un chiffre plutôt que d'une
   colonne.
4. **Un besoin réellement par requête ailleurs dans le site.** Le jour où l'ADR
   0006 admet une frontière dynamique, ces deux renoncements ne se justifient
   plus par eux-mêmes : il faudra décider si l'adresse retirée et l'image de
   partage sont du bon côté de cette frontière, ce qui n'est pas évident dans un
   sens comme dans l'autre.
