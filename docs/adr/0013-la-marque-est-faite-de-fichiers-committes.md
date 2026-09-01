# 13. La marque est faite de fichiers committés, et ce sont des octets qu'on vérifie

- **Statut** : accepté
- **Date** : 2026-09-01
- **Contexte du ticket** : TIW-23 (marque provisoire — logotype, favicon, image
  de partage par défaut), consignée par TIW-32
- **Complète** : `docs/adr/0012-deux-renoncements-du-prerendu.md`, dont elle
  prolonge le second renoncement jusqu'à ce qui l'a remplacé

## Contexte

Deux fichiers d'identité que le navigateur va chercher **comme des documents à
part entière** : `src/app/icon.svg`, le favicon, et
`public/opengraph-default.png`, l'image de partage par défaut du site.

Ni l'un ni l'autre ne peut être un composant. Un navigateur qui récupère un
favicon, une plateforme qui déroule un lien partagé : les deux demandent une URL
et lisent ce qu'elle rend, hors de tout arbre React, hors de tout `<head>` de
page, et hors de toute custom property déclarée par la feuille de style du site.

Et les deux cassent en silence, pour la même raison structurelle : **rien dans
ce dépôt ne les émet**. Les `<link rel="icon">` viennent de la convention de
fichier de Next (`src/app/icon.svg`, `src/app/apple-icon.png`) et d'aucun
composant ni `generateMetadata` ; le chemin de l'image de partage est une chaîne
dans `src/app/share.ts`. Renommez l'un, redimensionnez l'autre : `next build`
sort en 0, tous les tests restent verts, et le défaut est découvert par un
humain, sur un lien déjà envoyé.

## Décision

### Un. Le favicon est un document XML écrit à la main, et son garde compte des octets

`src/app/icon.svg` a cassé **trois fois** sur la branche de TIW-23. Chaque fois
avec `next build` en code 0, tous les tests verts, tous les
`<link rel="icon">` en place — et rien de dessiné.

1. **Un `--` dans un commentaire XML.** Un commentaire XML ne peut pas contenir
   deux tirets consécutifs : une phrase qui mentionne `--logo-ink` rend le
   fichier malformé.
2. **Un `<` nu dans un commentaire CSS, hors CDATA.** En HTML, `<style>` est un
   élément de texte brut et son contenu n'est jamais lu comme du balisage ; en
   XML, non. Un `<img>` cité dans la prose est lu comme le début d'une balise, et
   le fichier meurt sur « unexpected close tag ». Découvert en corrigeant le
   premier.
3. **Le terminateur de CDATA écrit en clair dans la prose.** Trois caractères
   ordinaires, qui ferment la section en avance ; libxml2 répond
   « Sequence ']]>' not allowed in content ».

Le mode d'échec est le même les trois fois, et c'est celui de l'invariant 1 : en
ligne dans une page, le parseur permissif de HTML dessine la marque quand même ;
récupéré comme favicon ou à travers un `<img>`, le navigateur parse en XML,
tombe sur une erreur fatale et ne dessine rien. Mesuré en Chromium : **neuf
`<img src="/icon.svg">`, tous à `naturalWidth 0`**, pour une paire de tirets
dans un commentaire.

**Le fait qui porte cette ADR est le troisième cas.** Le `DOMParser` de jsdom
l'a **accepté**, pendant que `xmllint` et Chromium le refusaient tous les deux.
Le test unitaire de bonne formation — qui existait, et qui avait attrapé les
deux premiers — serait donc passé au vert sur un fichier qu'aucun navigateur ne
peut dessiner. Autrement dit : **un test unitaire ne pouvait pas, structurellement,
voir ce cas-là.** Sa dépendance à une implémentation de parseur est ce qui le
rend aveugle, et aucune assertion plus fine sur le même parseur n'y changerait
rien.

D'où deux gardes de natures différentes, dont aucune ne remplace l'autre.

**Un garde qui compte les délimiteurs dans le texte brut**, dans
`tests/components/site/brand-art.test.ts` : exactement une ouverture
`<![CDATA[`, exactement un terminateur, le terminateur après l'ouverture, et la
déclaration `fill: var(--logo-ink)` avant lui — si le terminateur remontait
au-dessus d'elle, la règle de remplissage serait lue comme du balisage. Compter
des octets ne dépend d'aucune implémentation, et c'est le seul point du
dispositif dont on puisse dire ça.

**Un test de bout en bout qui décode réellement le fichier**, dans
`tests/e2e/brand.spec.ts` : `new Image()`, `await image.decode()` — qui rejette
sur un document malformé — puis `naturalWidth` et `naturalHeight` attendus à
**48 × 48**, la taille intrinsèque que le `viewBox` déclare. Zéro est ce que
produit une erreur de parsage, et c'est ce que ce test refuse.

Le même fichier rastérise aussi l'icône à **16 px**, taille de barre d'onglets,
et lit le pixel au centre de la tête de la comète : luminance attendue sous 0,2
en thème clair, au-dessus de 0,6 en thème sombre. Un favicon est récupéré comme
son propre document et n'hérite d'aucune custom property de la page — il porte
donc sa propre requête `prefers-color-scheme`, et qu'un navigateur y propage la
préférence du visiteur est un comportement de navigateur et non du nôtre. La
seule façon honnête de le vérifier est de dessiner et de regarder un pixel.

Trois autres propriétés sont figées par le test unitaire, parce qu'elles cassent
elles aussi sans bruit : le fichier ne porte **qu'un seul** `<path>` et c'est
`BRAND_COMET_PATH` caractère pour caractère ; le `viewBox` est celui de la
marque (un chemin identique dans une autre boîte est une autre marque) ; et
aucune couleur littérale n'est posée sur le path — un `fill="#0c2731"` ici
serait une marque figée au thème clair, invisible sur une barre d'onglets
sombre, et rien dans le build ne le dirait.

La marque du favicon ne porte d'ailleurs pas la trajectoire en pointillé du
logotype d'en-tête, et c'est une décision de dessin plutôt qu'une
simplification : l'encre contre l'accent mesure **1,99:1** en clair et
**1,35:1** en sombre sur cette palette, donc un détail accentué _à l'intérieur_
de la marque ne se voit pas, et à 16 px les points d'un filet détaché et leurs
intervalles sont sous le pixel. Ici la comète est une masse connexe, sans vide
interne. Mesurée contre les huit gris de barre d'onglets de Chrome, Firefox et
Safari, clair et sombre : **10,31:1 au pire, 15,55:1 au mieux**, tous AA.

### Deux. L'image de partage par défaut est un PNG committé de 1200 × 630

Deux raisons, dans cet ordre.

**Les plateformes refusent le SVG.** `src/app/icon.svg` est la même marque et
pèse quelques centaines d'octets, et aucune plateforme qui déroule un lien ne le
décode. Un `og:image` qu'un consommateur ne sait pas décoder ne retombe pas sur
une carte sans image : il retombe sur **aucune carte**.

**Une route génératrice a déjà été mesurée et écartée.** C'est le second
renoncement de l'ADR 0012, et il s'applique identiquement ici : `ƒ` sans
`generateStaticParams`, et un `●` mensonger avec — aucun fichier écrit sur le
disque, route rangée sous `dynamicRoutes`, donc jamais pesée par
`npm run test:build`. Un fichier sous `public/` est des octets que le CDN sert.

**La contrainte à écrire, parce qu'elle n'est devinable nulle part : les
dimensions doivent rester 1200 × 630.** `og:image:width` et `og:image:height`
sont ce qui permet à une plateforme de réserver la boîte de la carte avant que
les octets n'arrivent. Une image de remplacement d'une autre taille rend ces
deux balises fausses, et la carte se réagence une fois l'image chargée — la
seule chose qu'un aperçu ne doit pas faire. `tests/build/brand.test.ts` ne le
croit pas sur parole : il lit l'en-tête **IHDR** du fichier, premier chunk de
tout PNG, où la largeur et la hauteur sont deux entiers 32 bits gros-boutistes
aux offsets 16 et 20, et les exige à 1200 et 630.

1200 × 630 est la taille que toutes ces plateformes documentent, et c'est
1,91:1 — un consommateur qui recadre en 2:1 prend 15 px de chaque côté, bien à
l'écart de la marque.

Remplacer l'image est une **copie de fichier** par-dessus
`public/opengraph-default.png`, sans aucune modification de code.

Un corollaire en découle, et il a supprimé du code : puisqu'il y a désormais
toujours une image — la photo de couverture d'un voyage, sinon la marque —
`twitter:card` vaut `summary_large_image` **toujours**, et la branche `summary`
a été supprimée plutôt que laissée en code mort. La règle antérieure était
« grande carte seulement quand il y a une image à agrandir », parce que demander
la grande carte sans image produit le large rectangle gris avec un titre tassé
dans un coin.

### Les gardes, et ce que chacun tient

| garde                                     | ce qu'il tient                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/components/site/brand-art.test.ts` | le SVG est bien formé, ses commentaires XML n'ont pas de `--`, sa CDATA s'ouvre et se ferme une fois, sa géométrie est celle de l'en-tête       |
| `tests/e2e/brand.spec.ts`                 | le favicon se décode vraiment (48 × 48), il suit le thème, et les trois fichiers sont servis en 200 avec le bon `content-type`                  |
| `tests/build/brand.test.ts`               | chaque document prérendu porte ses deux `<link>`, le PNG existe et son IHDR dit 1200 × 630, et chaque document `/fr` porte un `og:image` absolu |

Un détail du dernier vaut d'être noté, parce qu'il est de la même famille que
tout le reste : `/_global-error` est exclu de la vérification des `<link>` —
Next le rend depuis son propre composant, avec son propre `<head>`, et les
métadonnées de l'application n'y tournent jamais — mais l'exclusion est
**dérivée d'un marqueur dans le HTML** (`id="__next_error__"`) plutôt qu'écrite
en dur, et le test exige qu'elle exclue **exactement une** route. Une exclusion
en dur est une exclusion qui s'élargit en silence, et le dépôt a déjà payé
celle-là ailleurs (ADR 0006, la liste de routes en dur).

L'absoluité de l'`og:image` est vérifiée sur l'artefact et non en test unitaire,
et c'est délibéré : `share.ts` remet à Next un `/opengraph-default.png`
relatif au site, et c'est `metadataBase` qui le résout. Une plateforme qui va
chercher la carte est sur un autre hôte — un `og:image` relatif n'y est
simplement pas récupérable, et la panne est invisible depuis l'intérieur du
site.

## Alternatives écartées

**Un favicon en PNG plutôt qu'en SVG.** Écarterait tout le problème de parsage
XML — et perdrait le thème : un PNG ne suit aucune préférence de couleur. C'est
précisément le compromis inverse retenu pour `src/app/apple-icon.png`, qui porte
la seule couleur en dur du lot parce qu'iOS le compose sur un fond d'écran
inconnu et qu'une plaque opaque y vaut mieux qu'une marque adaptative. Pour la
barre d'onglets, l'échange va dans l'autre sens.

**Documenter le fichier dans un commentaire XML.** C'est ce qui l'a cassé la
première fois. La prose vit maintenant dans un commentaire CSS à l'intérieur de
la CDATA, où `--` est légal.

**Ne pas documenter le fichier du tout.** Écarté pour la raison la plus directe
qui soit : les trois pièges se reproduisent à la première phrase ajoutée par
quelqu'un qui ne les connaît pas, et les trois sont invisibles à la relecture.

**Se fier au seul test de bonne formation XML.** Mesuré insuffisant : jsdom a
accepté le troisième cas. Le test est **conservé** — il attrape les deux
premiers et une assertion voisine nomme leur cause, ce qui vaut mieux qu'une
ligne rouge disant « XML est mécontent » — mais il n'est pas la garde.

**Générer `icon.svg` depuis `brand-art.ts` au build.** Supprimerait la
duplication de la géométrie, et remettrait un artefact généré exactement là où
l'ADR 0012 vient d'écrire pourquoi un fichier committé vaut mieux. Non chiffrée :
personne n'a mesuré ce que ce script coûterait ni où il tournerait. La
duplication est gardée par le test de dérive à la place.

**Une image de partage en SVG.** Refusée par les plateformes, et le mode d'échec
est « aucune carte », pas « carte dégradée ».

**Une image de partage générée par page ou par voyage.** Mesurée et écartée par
l'ADR 0012, y compris dans sa variante `dynamicParams = false`.

## Ce qu'on paie

**La géométrie existe en deux exemplaires, et elle ne peut pas exister en un.**
Le composant d'en-tête la rend en SVG en ligne — seule façon d'hériter de
`--logo-ink` et de suivre le thème du visiteur — et le navigateur récupère
`icon.svg` comme un document séparé, où une constante React est inatteignable.
Le test de dérive lit le `.svg` sur le disque et compare le `d` caractère pour
caractère ; rouge, il veut dire que l'un des deux a été modifié seul.

**Quatre fichiers bougent ensemble, et deux seulement sont gardés l'un contre
l'autre.** `brand-art.ts`, `icon.svg`, `apple-icon.png` et
`opengraph-default.png` portent la même marque. Le test de dérive compare les
deux premiers ; les deux PNG sont des rastérisations à régénérer à la main, et
rien ne rougit s'ils restent en retard d'une version du dessin. Les dimensions
d'`apple-icon.png` ne sont vérifiées par rien non plus — seule l'existence de sa
route de sortie l'est ; le contrôle IHDR ne porte que sur l'image de partage.

**Le test de bout en bout est Chromium seulement.** Firefox et Safari ne sont
pas couverts, et le fichier de test le dit explicitement plutôt que de laisser
croire le contraire.

**Il faut ne jamais écrire trois caractères dans un fichier.** C'est une
contrainte que rien n'empêche d'oublier — seulement une contrainte qu'un test
attrape après coup. Le fichier la formule en toutes lettres, ce qui est le
maximum de ce qu'on peut faire sans interdire d'y écrire de la prose.

**Tous les voyages sans photographie partagent la même image.** C'est le prix de
l'ADR 0012 payé ici, et il est visible : deux récits différents se déroulent
dans une conversation avec la même vignette.

## Ce qui invaliderait cette décision

1. **Une marque définitive.** Celle-ci est provisoire, le README le dit, et son
   remplacement est prévu comme une copie de fichier. Mais si le dessin
   définitif comporte plusieurs masses, un dégradé ou un tracé, l'assertion
   « exactement un `<path>`, et pas de `fill` littéral » tombe — et il faudra
   décider ce que le garde de dérive compare à sa place, avant de changer le
   dessin et non après.
2. **Un rastériseur au build écrivant de vrais PNG par voyage** (signal 2 de
   l'ADR 0012). L'image par défaut resterait pour les pages qui n'en ont pas,
   mais elle cesserait d'être ce que voit la plupart des liens partagés, et la
   pesée du fichier committé perdrait son importance.
3. **Une plateforme majeure acceptant le SVG en `og:image`.** La première raison
   du PNG tombe ; la seconde — un fichier plutôt qu'une route — tient toujours,
   et c'est elle qui décide.
4. **Un format de favicon qui échapperait au parsage XML tout en suivant le
   thème.** Aucun n'existe aujourd'hui, et le dépôt n'en a pesé aucun. Le jour
   où il en existe un, tout le dispositif de comptage d'octets devient sans
   objet — ce qui serait un bon jour.
