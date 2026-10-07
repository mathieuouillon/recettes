---
title: Écrire en Gram
icon: fas fa-pen-nib
order: 4
---

Chaque recette du site est un fichier texte `.gram` placé dans le dossier
`recettes/` du dépôt. Cette page résume la syntaxe ; la documentation complète
est sur [gram-lang.org](https://gram-lang.org/fr/).

## Une recette minimale

```text
---
title: "Crêpes"
category: "Desserts"
tags: ["goûter"]
portions: 4
date: 2026-10-06
---

## Pâte ->&pâte

[Mélanger] La @farine{250 g}, les @œufs{4} et le @lait{50 cl} dans un #saladier{}.
Laisser reposer ~_{1 h}.

## Cuisson

[Cuire] Verser la &pâte dans une #poêle{} sur ^{feu vif}, ~{1 min} par face.
```

Un paragraphe est une étape ; une ligne vide sépare deux étapes. Les titres
`##` découpent la recette en parties (pâte, garniture, montage…).

## L'en-tête

| clé | rôle |
|---|---|
| `title` | nom de la recette |
| `description` | phrase d'accroche (sinon le site en compose une) |
| `category` | catégorie du site : `Desserts`, `Plats`, `Pains`… |
| `tags` | étiquettes, par exemple `["citron", "facile"]` |
| `portions` | nombre de portions ; active les boutons − et + |
| `makes` | ce que donne la recette : `"1 tarte de 24 cm"` |
| `date` | date de publication, `AAAA-MM-JJ` |
| `notes` | remarque affichée en bas de la recette |
| `author`, `source` | auteur et lien vers la recette d'origine |
| `image` | photo : `/assets/img/recettes/crepes.webp` |
| `publier` | `false` pour garder un fichier hors du site |

Pour une apostrophe, écrivez la valeur entre guillemets doubles ou utilisez
l'apostrophe typographique : `makes: "1 miche d’environ 850 g"`.

## Les balises

| écrit | sens | exemples |
|---|---|---|
| `@` | ingrédient | `@sel`, `@farine{250 g}`, `@œufs{3}` |
| `#` | matériel | `#fouet`, `#casserole{}`, `#ramequins{6}` |
| `~` | temps de travail | `~{10 min}`, `~{8-10 min}` |
| `~_` | attente (four, repos, levée) | `~_{45 min}`, `~_four{20 min}` |
| `^` | température ou feu | `^{180 °C}`, `^{feu doux}` |
| `[…]` | verbe d'action en tête d'étape | `[Pétrir]`, `[Cuire à blanc]` |
| `->&` | nomme ce qu'une étape ou une partie produit | `->&pâte`, `->&crème citron{}` |
| `&` | réutilise ce résultat plus loin | `&pâte`, `&pâte{300 g}` |
| `//`, `/* */` | commentaire affiché en italique | `// se congèle bien` |

Un nom de plusieurs mots se termine toujours par des accolades, même vides :
`@huile d'olive{}`, `#poêle à crêpes{}`. Sans elles, seul le premier mot est
pris. Pour le matériel, les accolades ne contiennent qu'un nombre ; la taille
va entre parenthèses : `#moule{}(24 cm)`.

Les minuteurs qui portent le même nom s'enchaînent au lieu de se chevaucher :
`~_four{25 min}` puis `~_four{20 min}` font 45 minutes de four.

## Les modificateurs

Ils se placent juste après `@` ou `#`.

| écrit | sens |
|---|---|
| `@&beurre{20 g}` | même ingrédient que plus haut ; la quantité s'ajoute à la liste de courses |
| `@=sel{1 pincée}` | quantité fixe, qui ne change pas avec les portions |
| `@?rhum{1 c.à.s}` | facultatif |
| `@-eau{}` | n'apparaît pas dans la liste de courses |
| `@*farine{500 g}` | farine de référence pour les pourcentages du boulanger |

## Pour aller plus loin

- **Préparation** collée à l'ingrédient : `@beurre{50 g}(fondu)`,
  `@oignons{2}(émincés)`.
- **Au choix** : `@rhum{1 c.à.s}|@eau de fleur d'oranger{1 c.à.s}`.
- **Fourchettes et fractions** : `@œufs{2-3}`, `@sucre{1/2 tasse}`.
- **Parties d'un ingrédient** : `@jus de citron{120 ml}<@citrons{3}` et
  `@zeste de citron{2}<@citrons{2}` donnent 3 citrons à acheter, pas 5
  (sans espace autour de `<`).
- **Pourcentages** : `@eau{68% @&farine T80}` se recalcule si la farine change.
- **Anticipation** : `## Pâte ~{-1d}` se prépare la veille ; `~{-2h}`,
  deux heures avant.
- **Bases réutilisables** : une pâte de `recettes/bases/` s'importe en tête de
  recette avec `@use "@bases/pate-sablee.gram" as &pâte`. Ses ingrédients
  rejoignent la liste de courses et ses étapes s'insèrent dans la recette.

## Tester des variantes

Pour chercher la bonne version d'une recette, on crée des **variantes** : des
copies que l'on modifie sans toucher à l'originale.

```bash
npm run variante -- crepes "moins de sucre"
npm run variante -- crepes "repos long" --objectif "Voir si 3 h changent la texture"
```

La commande crée `recettes/crepes--moins-de-sucre.gram`, rattachée à
`crepes.gram` par `variante_de: crepes`. On la modifie comme n'importe quelle
recette : quantités, temps, étapes. Le site garde la trace de l'expérience.

- La page de la variante montre **ce qui change** par rapport à l'originale :
  quantités avant → après, ingrédients ajoutés ou retirés, étapes modifiées. Dans
  la liste, les ingrédients qui changent sont marqués.
- La page de la recette liste toutes ses variantes avec un **tableau
  comparatif** où les cases qui diffèrent sont en couleur.
- Les variantes restent hors de l'accueil, des archives et de la recherche :
  on y arrive depuis la recette d'origine.

Trois champs de l'en-tête servent à garder le fil :

| clé | rôle |
|---|---|
| `objectif` | ce que vous cherchez à tester |
| `verdict` | ce que ça a donné, après dégustation |
| `statut` | `essai` (par défaut), `retenue` ou `ecartee` |

Une variante `retenue` est annoncée en haut de la recette d'origine, avec son
verdict. Gardez `objectif` et `verdict` sur une seule ligne, entre guillemets ;
`\n` à l'intérieur fait un retour à la ligne.

On peut partir d'une variante pour en faire une autre :
`npm run variante -- crepes--moins-de-sucre "avec du rhum"`. Elle se rattache
toujours à la recette d'origine, et les quantités sont comparées pour le nombre
de portions de l'originale.

Pour comparer dans le terminal :
`npx gram diff recettes/crepes.gram recettes/crepes--moins-de-sucre.gram`.

## Vérifier une recette

Dans le dépôt, `npm run verifier` compile toutes les recettes et signale les
erreurs (référence inconnue, unité manquante…) avec leur numéro de ligne.
L'[extension VS Code](https://gram-lang.org/fr/docs/reference/tooling/vscode-extension/)
colore la syntaxe et souligne les erreurs pendant la frappe, et le
[bac à sable](https://gram-lang.org/fr/play/) permet d'essayer sans rien
installer.
