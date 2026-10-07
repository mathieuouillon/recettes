# Recettes

Un site de recettes de cuisine en français, écrites en
[Gram](https://gram-lang.org/fr/) et publiées avec Jekyll et le thème
[Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy).

Adresse : <https://mathieuouillon.github.io/recettes/>

## Comment ça marche

```
recettes/*.gram  ──(tools/gram-jekyll.mjs)──▶  _posts/gram/*.html + _variantes/*.html  ──(Jekyll + Chirpy)──▶  _site/
```

1. Chaque recette est un fichier `.gram` dans `recettes/`. Les bases
   réutilisables (pâtes, crèmes…) vont dans `recettes/bases/` et s'importent
   avec `@use "@bases/<fichier>.gram" as &nom`.
2. `tools/gram-jekyll.mjs` passe chaque fichier dans le pipeline officiel de
   Gram (`@gram-lang/cli` : modules, compilation, analyse des masses), puis
   écrit un article Chirpy en HTML : fiche (portions, temps), liste de
   courses, matériel, étapes, notes et code source Gram coloré.
3. Jekyll construit le site. Sur GitHub, le workflow
   `.github/workflows/pages-deploy.yml` enchaîne ces étapes à chaque push.

`_posts/gram/` et `_variantes/` sont entièrement régénérés : ne les modifiez pas
à la main (ils ne sont pas suivis par git). Le script `assets/js/recette.js` recalcule les
quantités dans le navigateur quand on change le nombre de portions.

## Ajouter une recette

1. Créez `recettes/ma-recette.gram` (le nom du fichier donne l'adresse :
   `/posts/ma-recette/`). L'onglet « Écrire en Gram » du site résume la
   syntaxe ; les recettes existantes servent d'exemples.
2. Vérifiez-la :

   ```bash
   npm run verifier
   ```

3. Publiez-la : `git add`, `git commit`, `git push`. Le site est à jour une
   à deux minutes plus tard.

Une erreur Gram (référence inconnue, base introuvable…) bloque la
construction, en local comme sur GitHub, avec le numéro de ligne en cause.

## Tester des variantes d'une recette

```bash
npm run variante -- crepes "moins de sucre"
npm run variante -- crepes "repos long" --objectif "Voir si 3 h changent la texture"
```

La commande copie `recettes/crepes.gram` en `recettes/crepes--moins-de-sucre.gram`
et l'en-tête la rattache à l'originale (`variante_de: crepes`) ; on modifie
ensuite la copie. Sur le site :

- la page de la variante (`/variantes/<nom>/`) liste **ce qui change** par rapport
  à l'originale et marque les ingrédients modifiés ;
- la page de la recette présente ses variantes et un **tableau comparatif** ;
- les variantes sont absentes de l'accueil, des archives et de la recherche.

En-tête d'une variante : `variante_de` (fichier de la recette d'origine, sans
`.gram`), `variante` (nom court), `objectif`, `verdict` et `statut` (`essai`,
`retenue` ou `ecartee`). Une variante `retenue` est annoncée en haut de la
recette d'origine. `npm run verifier` contrôle ces champs.

Le code vit dans `tools/` : `variante.mjs` crée le fichier, `variantes.mjs`
compare les versions et fabrique les blocs HTML, `commun.mjs` regroupe les
fonctions partagées avec `gram-jekyll.mjs`. Les pages sont générées dans
`_variantes/` (comme `_posts/gram/`, absent de git).

## Aperçu local

Il faut Node.js ≥ 22 et Ruby ≥ 3 (sur macOS : `brew install ruby@3.4`).

```bash
npm run serve
```

Le site est servi sur <http://127.0.0.1:4000/recettes/> et chaque
modification d'un `.gram` est recompilée aussitôt.

## Publier la première fois

```bash
./publier.sh
```

Le script crée le dépôt public `recettes`, active GitHub Pages en mode
« GitHub Actions », pousse le code et suit le déploiement.

## Outils Gram utiles

La CLI Gram est installée avec les dépendances (`npx gram …`) :

- `npx gram view recettes/crepes.gram` affiche une recette dans le terminal ;
- `npx gram shop "recettes/*.gram"` fait une liste de courses commune ;
- `npx gram import <url>` convertit une recette du web en `.gram` (demande une
  clé d'API, voir la [documentation](https://gram-lang.org/fr/docs/reference/tooling/cli/)).
