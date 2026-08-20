# 1. Le domaine est du TypeScript pur

- **Statut** : accepté
- **Date** : 2026-08-20
- **Contexte du ticket** : TIW-8 (modèle de domaine)

## Contexte

Le contenu du site vit dans des fichiers YAML versionnés, sans base de données.
C'est un choix assumé au jalon 1 — pas de serveur, tout prérendu au build — mais
c'est aussi un choix **qu'on ne sait pas encore juger**. Un journal de voyages qui
grossit, une édition à plusieurs mains ou un besoin de recherche plein texte
peuvent le rendre intenable, et il faudra alors basculer vers une base ou un CMS.

Or les règles qui définissent ce qu'est un voyage valide — un itinéraire continu,
des étapes ordonnées, un budget en centimes entiers, des coordonnées qui ne sont
pas le résultat d'un géocodage raté — n'ont aucun rapport avec l'endroit où le
contenu est stocké. Si elles sont écrites au milieu du code qui lit les fichiers,
elles partent avec lui le jour où le stockage change.

Il existe un deuxième aiguillon, plus immédiat : la vitesse de vérification. Une
règle métier testée à travers un Server Component impose un environnement DOM,
un rendu et un `await`. La même règle testée en fonction pure se vérifie par
centaines en moins d'une seconde, ce qui est la condition pour qu'un cas limite
soit couvert plutôt que supposé.

## Décision

`src/domain/**` ne dépend que de **Zod**. Ni React, ni Next, ni `next-intl`, ni
module Node (`node:*`, `fs`, `path`), ni d3, ni topojson, ni `server-only`, ni
aucun autre module `@/` — donc ni `src/content`, ni `src/map`, ni `src/app`.
À l'intérieur du domaine, les modules se référencent en relatif (`./geo`), et le
dossier reste plat.

Conséquences directes sur la façon d'écrire ce code :

- **Les schémas Zod sont la source de vérité des types.** Chaque type exporté est
  un `z.infer` ; aucune forme n'est saisie deux fois.
- **Les dates civiles sont des chaînes `AAAA-MM-JJ`**, jamais des `Date`. Aucun
  calcul ne lit le fuseau de la machine : l'écart en jours se calcule sur les
  champs civils. La suite tourne sous `TZ=Pacific/Auckland` et
  `TZ=America/Santiago` pour le prouver.
- **L'argent est en centimes entiers.** Le domaine divise et arrondit, il ne
  formate pas — le formatage est de la locale, donc de la couche de présentation.
- **La lecture de fichiers, le géocodage et la projection cartographique sont
  dehors.** Le domaine reçoit des données déjà lues et rend des valeurs déjà
  calculées (`drawableMoves` rend des coordonnées, pas un `<path>` SVG).

La frontière est **mécanique** : `eslint.config.js` porte un bloc
`travels-in-world/domain-purity` qui refuse ces imports via
`no-restricted-imports`, sur les quatre extensions TypeScript (`.ts`, `.tsx`,
`.mts`, `.cts`) — une revue adverse a montré qu'un `src/domain/Widget.tsx`
important React passait, et que les deux extensions modulaires n'étaient
couvertes par aucun bloc. Les fichiers `*.test.*` co-localisés en sont exemptés,
sinon la co-location autorisée par `vitest.config.ts` deviendrait un piège.

### La règle est elle-même testée

`npm run test:lint` (`tests/lint/domain-purity.test.ts`) lance ESLint par son API
Node sur des sources en mémoire et vérifie que la règle refuse bien ce qu'elle
prétend refuser : les quatre extensions, les six orthographes relatives, les
spécificateurs profonds, l'alias `@/`, plus deux contrôles — un fichier de domaine
propre ne doit produire aucune erreur, et un fichier **hors** domaine doit rester
libre d'importer React.

Ce n'est pas du zèle : cette frontière a régressé **deux fois dans le ticket qui
l'a créée**, et les deux fois la règle existait et semblait fonctionner. Une sonde
manuelle supprimée après usage prouve un état, elle ne défend pas un invariant.
La garde a été prouvée par l'échec, comme celle du prérendu : reverser le glob
rougit 3 cas, supprimer le motif `".."` en rougit 6, élargir la règle à tout `src/`
en rougit 1, retirer l'exemption des specs en rougit 4.

Elle vit dans sa propre configuration Vitest parce qu'elle exige
`environment: "node"` — sous jsdom, `import.meta.url` n'est pas une URL `file:` —
et que cet environnement est incompatible avec `tests/setup.ts`. À brancher en CI
au même titre que `test:build`.

### Ce que la règle ne peut pas garantir

`no-restricted-imports` compare des **chaînes de spécificateurs**, sans jamais
résoudre un chemin. Trois conséquences mesurées, à connaître avant de s'y fier :

- Une forme relative n'est refusée que si un motif la couvre, et le motif évident
  est le mauvais : `"../**"` laissait passer `"./../content/trips"` — le même
  module pour le bundler — qui traversait `lint`, `typecheck` **et** `build`. Le
  motif retenu est `".."` seul, qui couvre les six orthographes mesurées tout en
  laissant passer le `"./geo"` d'un frère. L'exhaustivité, elle, reste
  indémontrable par cette approche. Le jour où ce trou compte vraiment, le remède
  est une règle qui raisonne sur des chemins **résolus**
  (`import/no-restricted-paths` et sa notion de zones), au prix d'une dépendance à
  peser contre le budget de l'invariant 4 d'`AGENTS.md`.
- `await import("node:fs")` n'est pas une déclaration d'import mais une expression
  d'appel : aucune option de la règle ne la voit. Angle mort assumé, le même que
  pour `next/link`. En revanche `require("fs")` **est** bloqué — par
  `@typescript-eslint/no-require-imports`, pas par cette règle.
- En sens inverse, rien n'est à ajouter pour les imports profonds : un nom de
  paquet nu couvre tout ce qui est dessous, comme un dossier dans un `.gitignore`.
  Vérifié sur `node:fs/promises`, `next/dist/client/link`,
  `d3-geo/src/path/index.js`, `react/jsx-runtime`, `react-dom/server`,
  `next-intl/server` et `topojson-client/src/feature.js`.

### Le domaine fait confiance à son entrée, et c'est une convention

Corollaire de la décision, à écrire noir sur blanc parce que **aucune règle
ESLint ne peut l'imposer** : `PlainDate`, `Slug`, `CountryCode` et `Tag` sont des
alias nus de `string`. Rien n'empêche donc d'appeler `durationOf` avec une chaîne
arbitraire, et comme `yaml.parse` rend `any`, du contenu non validé peut traverser
la frontière sans un mot du compilateur.

Le remède classique serait des types **brandés**. Il est écarté délibérément : les
225 tests du contrat assignent des littéraux de chaîne aux schémas et aux
dérivations, et un type brandé les rendrait inécrivables sans cast — or un cast
dans un test de validation est exactement la façon dont un test de validation
cesse de tester quelque chose. On ne réécrit pas la suite pour ça.

La discipline est donc **conventionnelle, et unique** : le seul point d'entrée
légitime du domaine est le module de contenu, qui **parse avant d'appeler**. Un
`Trip` circule sous forme de valeur sortie de `TripSchema.parse()`, jamais sous
forme d'objet YAML brut. Toute nouvelle façade — un script, une route, un test de
bout en bout — reprend cette obligation à son compte.

Deux exceptions, et deux seulement, sont traitées **dans le code** plutôt que par
la convention, parce qu'elles sont réellement atteignables depuis du YAML et
qu'elles coûtaient un plantage :

- `budget:` laissé vide donne `null`, pas `undefined` : `budgetPerPerson` accepte
  les deux (`== null`).
- une coordonnée non finie donne `NaN`, et `NaN < 1` est `false` :
  `drawableMoves` filtre sur `!(distance >= 1)`, ce qui écarte les deux cas.

### Une contradiction résiduelle, assumée

Sur un voyage aux slugs de lieux dupliqués, les deux dérivations ne racontent pas
la même histoire : `drawableMoves` construit une `Map` et retient donc la
**dernière** déclaration, tandis que `visitedCountryCodes` parcourt `places[]` et
compte **les deux** pays. Ce n'est pas corrigé, parce que `TripSchema` refuse les
slugs dupliqués : l'état est inatteignable par le chemin légitime. C'est la
convention ci-dessus qui le garantit, pas le typage — et c'est précisément le
genre d'incohérence qui referait surface si on appelait le domaine sans parser.

## Conséquences

**Ce qu'on gagne.** Le choix « contenu en fichiers » devient réversible : passer à
une base ne touche que le module de contenu, qui appellera les mêmes schémas sur
des lignes au lieu de fichiers. Les 234 tests du domaine tournent sans framework,
sans DOM et sans build, en moins d'une seconde. Et une règle métier a un seul
endroit où vivre, donc une seule chance de se contredire — `validate:content` au
build et la page au rendu lisent le même `TripSchema`.

**Ce qu'on paie.** Une donnée dérivée coûte un aller-retour : le domaine ne peut
pas aller chercher lui-même les photos d'un voyage, l'appelant les lui passe.
Certaines validations _pourraient_ être plus riches en atteignant le disque —
vérifier que `coverPhotoSrc` existe vraiment sur le système de fichiers, par
exemple. Le domaine se contente de vérifier qu'elle figure dans `photos[]` ; la
vérification d'existence appartient à `validate:content` (TIW-9).

Une contrainte de plus, qui n'est pas évidente avant de l'avoir mesurée : Zod
exécute un `superRefine` **même quand un contrôle de feuille a déjà échoué**. Une
règle croisée peut donc recevoir `"2024-4-1"` là où elle attend un jour, et la
comparaison de chaînes — juste pour des dates bien formées — répond alors
n'importe quoi. Mesuré : une seule faute de frappe produisait huit erreurs, dont
six désignaient autre chose que la faute — cinq des étapes saines, une la date de
fin. Toute comparaison de dates du domaine passe donc
par un `isBefore` qui **s'abstient** quand l'une des deux valeurs n'a pas passé sa
propre validation. C'est la condition pour que le message de `validate:content`
désigne la bonne ligne.

**Ce qui invaliderait cette décision.** Trois signaux, dans l'ordre de gravité :

1. Une règle métier qui a réellement besoin d'un effet de bord pour être
   vérifiée — une validation d'unicité contre l'ensemble du corpus, ou un appel
   réseau. Le domaine ne saurait pas l'exprimer sans mentir sur sa pureté ; il
   faudrait alors distinguer explicitement un cœur pur d'une couche de règles
   applicatives, plutôt que de percer la frontière au cas par cas.
2. Le passage à une base de données avec un ORM dont les types sont générés. Si
   ces types deviennent la source de vérité, `z.infer` devient une deuxième
   déclaration parallèle — exactement ce que cette ADR interdit — et il faudra
   rechoisir lequel des deux fait foi.
3. Le remplacement de Zod. La dépendance est unique mais elle est réelle : ce
   n'est pas « zéro dépendance », c'est « une seule, et à la frontière ».

Aucun de ces signaux n'est présent aujourd'hui.
