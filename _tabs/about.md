---
# the default layout is 'page'
icon: fas fa-info-circle
order: 5
---

Ce site rassemble des **recettes de cuisine en français**, écrites en
[Gram](https://gram-lang.org/fr/), un langage de recettes en texte brut.

Chaque recette est un fichier `.gram` : on y marque les ingrédients (`@`), le
matériel (`#`), les minuteurs (`~`) et les températures (`^`). Gram compile
ce texte et en tire tout le reste :

- la **liste de courses** consolidée (le beurre de la pâte et celui du moule
  s'additionnent, le jus et le zeste viennent des mêmes citrons) ;
- le **temps de travail**, le temps d'attente et le temps total ;
- des **quantités ajustables** : les boutons − et + recalculent la recette
  pour le nombre de portions voulu ;
- les **bases réutilisables** (pâte sablée, pâte brisée…) importées d'une
  recette à l'autre.

Le fichier Gram d'origine est affiché en bas de chaque recette, et peut être
téléchargé. L'onglet [Écrire en Gram]({{ '/ecrire-en-gram/' | relative_url }})
résume la syntaxe.
