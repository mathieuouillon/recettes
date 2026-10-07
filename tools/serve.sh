#!/usr/bin/env bash
# serve.sh -- apercu local sur http://127.0.0.1:4000/recettes/
#
# Recompile les recettes a chaque modification d'un fichier .gram, pendant
# que Jekyll sert le site et recharge la page.
set -euo pipefail
cd "$(dirname "$0")/.."

# Jekyll et Chirpy demandent Ruby >= 3 (celui de macOS est trop ancien).
if [ -x /opt/homebrew/opt/ruby@3.4/bin/ruby ]; then
  export PATH="/opt/homebrew/opt/ruby@3.4/bin:$PATH"
fi

[ -d node_modules ] || npm ci
bundle check >/dev/null 2>&1 || bundle install

node tools/gram-jekyll.mjs
node --watch-path=recettes --watch-preserve-output tools/gram-jekyll.mjs &
SURVEILLANCE=$!
trap 'kill $SURVEILLANCE 2>/dev/null' EXIT

bundle exec jekyll serve --livereload
