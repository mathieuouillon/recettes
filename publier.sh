#!/usr/bin/env bash
# publier.sh -- cree le depot GitHub et publie le site de recettes sur GitHub Pages avec gh.
#
#   ./publier.sh               -> depot "recettes", https://<vous>.github.io/recettes/
#   ./publier.sh <nom-depot>   -> site de projet, https://<vous>.github.io/<nom-depot>/
#
# Le depot <vous>.github.io est deja pris par le premier site : celui-ci est
# donc publie comme site de projet, sous une adresse en /<nom-depot>/.
set -euo pipefail
cd "$(dirname "$0")"

command -v git >/dev/null || { echo "git est requis : https://git-scm.com"; exit 1; }
command -v gh  >/dev/null || { echo "gh est requis : https://cli.github.com"; exit 1; }
command -v npm >/dev/null || { echo "Node.js (npm) est requis : https://nodejs.org"; exit 1; }

if ! gh auth status >/dev/null 2>&1; then
  echo "Connexion a GitHub (gh auth login)..."
  gh auth login
fi

export UTIL BASE
UTIL=$(gh api user --jq .login)
DEPOT="${1:-recettes}"
if [ "$DEPOT" = "$UTIL.github.io" ]; then BASE=""; else BASE="/$DEPOT"; fi
echo "Compte : $UTIL   Depot : $DEPOT   Adresse : https://$UTIL.github.io$BASE/"

# 1. Adresse du site
perl -pi -e 's|^url: .*|url: "https://$ENV{UTIL}.github.io"|; s|^baseurl: .*|baseurl: "$ENV{BASE}"|' _config.yml

# 2. Verifier les recettes avant de publier (le meme controle tourne sur GitHub)
[ -d node_modules ] || npm ci
npm run --silent verifier

# 3. Depot local
[ -d .git ] || git init -q -b main
git add -A
git commit -qm "Site de recettes en Gram" || echo "(rien de nouveau a valider)"

# 4. Depot GitHub (sans pousser tout de suite)
if gh repo view "$UTIL/$DEPOT" >/dev/null 2>&1; then
  echo "Le depot $UTIL/$DEPOT existe deja : on le reutilise."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$UTIL/$DEPOT.git"
else
  gh repo create "$DEPOT" --public --source=. --remote=origin \
    --description "Recettes de cuisine en francais, ecrites en Gram"
fi

# 5. Activer GitHub Pages en mode "GitHub Actions" AVANT le premier push
if ! gh api -X POST "repos/$UTIL/$DEPOT/pages" -f build_type=workflow >/dev/null 2>&1; then
  gh api -X PUT "repos/$UTIL/$DEPOT/pages" -f build_type=workflow >/dev/null 2>&1 || {
    echo "Activation automatique de Pages impossible."
    echo "Faites-la a la main : Settings > Pages > Source : GitHub Actions, puis relancez."
    exit 1; }
fi

# 6. Pousser : le workflow compile les .gram, construit et deploie le site
git push -u origin main

# 7. Suivre le deploiement
echo "Attente du demarrage du workflow..."
sleep 8
RUN=$(gh run list -R "$UTIL/$DEPOT" --workflow pages-deploy.yml -L 1 --json databaseId --jq '.[0].databaseId')
gh run watch -R "$UTIL/$DEPOT" "$RUN" --exit-status
echo
echo "Site publie : https://$UTIL.github.io$BASE/"
echo "(la premiere mise en ligne peut demander une ou deux minutes de plus)"
