# Treize voyages portent des dates inventées

Les treize voyages ci-dessous sont réels ; **leurs dates ne le sont pas**. Aucune date n'avait
été fournie, et le carnet ne pouvait pas tourner sans : le schéma refuse depuis TIW-38 toute
date antérieure à 1900, ce qui faisait refuser la collection entière — les voyages, et avec eux
tout `content/trips`. Des dates provisoires ont donc été posées, à la demande explicite du
propriétaire, pour rouvrir le site en attendant les vraies.

**Quatre de ces treize avaient purement et simplement disparu.** Les quatorze lieux fournis le
4 septembre vivaient dans `content/places.yaml` (commit `8121e46`) ; ce fichier n'existe plus,
ni sur le disque ni dans `HEAD`, et la conversion en voyages n'en avait repris que dix. Rouen,
La Rochelle, Noirmoutier et Paris étaient tombés en route. Ils sont revenus avec les
coordonnées du commit d'origine — celles que `npm run geocode:places` avait résolues et qu'une
vérification point-dans-polygone contre `world-atlas` avait validées — et non des coordonnées
re-devinées. Le quatorzième lieu, Porticcio, n'a pas disparu : il est devenu le voyage
« Corse ».

## Comment on les reconnaît sans lire ce fichier

Deux marqueurs, posés pour que la fiction reste visible depuis la page rendue et pas
seulement depuis un commentaire que personne ne relit :

1. **Les treize départs tombent le 1er du mois.** Treize voyages consécutifs commençant tous un
   premier est une coïncidence que la réalité ne produit pas.
2. **Les treize partagent la même date de publication**, `2026-09-07`, le jour où elles ont été
   posées.

Le marqueur s'efface tout seul : chaque vraie date remplacée retire un voyage de la liste des
« tous les 1er », et le jour où ce fichier est vide, il se supprime.

## Les dates à remplacer

| Voyage | Pays | Début (fictif) | Fin (fictive) | Durée affichée |
| --- | --- | --- | --- | --- |
| Rouen | FR | 2023-04-01 | 2023-04-03 | 3 jours |
| Les Sables-d'Olonne | FR | 2023-07-01 | 2023-07-08 | 8 jours |
| La Rochelle | FR | 2023-09-01 | 2023-09-05 | 5 jours |
| Genève | CH | 2023-10-01 | 2023-10-04 | 4 jours |
| Annecy | FR | 2024-05-01 | 2024-05-05 | 5 jours |
| Barcelone | ES | 2024-06-01 | 2024-06-06 | 6 jours |
| Noirmoutier | FR | 2024-07-01 | 2024-07-07 | 7 jours |
| Roses | ES | 2024-08-01 | 2024-08-09 | 9 jours |
| Corse | FR | 2024-09-01 | 2024-09-10 | 10 jours |
| Paris | FR | 2025-02-01 | 2025-02-04 | 4 jours |
| Gand et Bruges | BE | 2025-04-01 | 2025-04-06 | 6 jours |
| Valence | ES | 2025-06-01 | 2025-06-05 | 5 jours |
| Crète | GR | 2025-08-01 | 2025-08-12 | 12 jours |

L'ordre entre eux est inventé lui aussi : il détermine « Derniers voyages » sur l'accueil et
le classement de la page « Tous les voyages ».

Pour Gand et Bruges, la date du trajet est fixée au 2025-04-04, à la charnière des deux
séjours ; le mode `train` reste **supposé**, il ne vient pas d'une source.

## Ce qui manque encore, en dehors des dates

- L'itinéraire crétois dans l'ordre, avec les modes de transport (atterrissage à Héraklion,
  puis toute l'île) — un seul séjour à Héraklion tient lieu de place-tenant.
- Les villes corses — même remarque, un seul séjour couvre l'île entière.
- L'ordre Gand → Bruges et le mode de transport.
- Rouen, La Rochelle, Noirmoutier et Paris sont chacun un voyage d'un seul séjour, faute
  d'itinéraire fourni. Si l'un d'eux appartient en réalité à un autre voyage — Noirmoutier avec
  Les Sables-d'Olonne, par exemple, qui sont à deux heures l'un de l'autre — c'est une fusion de
  deux fichiers, pas une réécriture.
- Aucune photo n'a été fournie pour aucun des treize, et aucun récit n'est écrit
  (`story: unwritten`). Ils sont donc sur la carte et dans les listes, avec « Récit à venir »
  sur leur fiche, et sans page à eux.

## Pour corriger un voyage

1. Ouvre `content/trips/<slug>/trip.yaml` et remplace les dates marquées `# FICTIF`, y
   compris celles des étapes.
2. Retire le bandeau de commentaire en tête du fichier.
3. Retire sa ligne du tableau ci-dessus.
4. `npm run validate:content` — doit passer sans un mot.

Deux géocodages restent à vérifier quand tu y toucheras : `valence` doit être Valencia
(Espagne) et non Valence (Drôme), et `gand-bruges` doit viser Brugge (Flandre-Occidentale) et
non Bruges (Gironde).
