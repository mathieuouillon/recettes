#!/usr/bin/env node
// variante.mjs -- cree une variante d'une recette, pour experimenter.
//
//   npm run variante -- <recette> "<nom de la variante>" [--objectif "<ce que vous testez>"]
//
//   npm run variante -- crepes "moins de sucre"
//   npm run variante -- crepes "repos long" --objectif "Voir si 3 h de repos changent la texture"
//   npm run variante -- crepes--moins-de-sucre "avec du rhum"   # a partir d'une autre variante
//
// Le fichier recettes/<recette>--<nom>.gram est une copie de la recette, avec en
// tete de quoi la rattacher a l'originale. On le modifie ensuite comme n'importe
// quelle recette ; le site montre ce qui change et compare les versions.

import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { RACINE, lireEntete, slug } from './commun.mjs';

const DOSSIER_RECETTES = path.join(RACINE, 'recettes');

// Cles d'en-tete que la variante redefinit (les autres sont copiees telles quelles).
const CLES_REMPLACEES = new Set(['title', 'description', 'date', 'variante_de', 'variante', 'statut', 'objectif', 'verdict', 'pin', 'publier']);

const AIDE = `Cree une variante d'une recette pour experimenter.

  npm run variante -- <recette> "<nom de la variante>" [--objectif "<ce que vous testez>"]

Exemples :
  npm run variante -- crepes "moins de sucre"
  npm run variante -- crepes "repos long" --objectif "Voir si 3 h de repos changent la texture"

<recette> est le nom du fichier sans .gram (ou son chemin). On peut partir d'une
autre variante : la nouvelle se rattache toujours a la recette d'origine.`;

function echec(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const relatif = (fichier) => path.relative(RACINE, fichier).split(path.sep).join('/');

const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Reecrit l'en-tete du fichier : nos cles d'abord, puis le reste de l'en-tete
// d'origine (commentaires et mise en forme conserves).
function reecrireEntete(source, nouvelles) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(source);
  const reste = [];
  let corps = source;
  if (m) {
    let supprime = false;
    for (const ligne of m[1].split(/\r?\n/)) {
      const cle = /^([A-Za-z_][\w-]*)\s*:/.exec(ligne);
      if (cle) supprime = CLES_REMPLACEES.has(cle[1]);
      // Une valeur supprimee peut tenir sur plusieurs lignes (liste, bloc indente).
      else if (supprime && !/^(\s|-(\s|$))/.test(ligne)) supprime = false;
      if (!supprime) reste.push(ligne);
    }
    corps = source.slice(m[0].length);
  }
  return `---${eol}${[...nouvelles, ...reste].join(eol)}${eol}---${eol}${corps}`;
}

async function main() {
  const positionnels = [];
  let objectif = '';
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--aide' || a === '--help') {
      console.log(AIDE);
      return;
    }
    if (a === '--objectif' || a === '-o') objectif = args[++i] ?? '';
    else if (a.startsWith('--objectif=')) objectif = a.slice('--objectif='.length);
    else if (a.startsWith('-')) echec(`Option inconnue : ${a}\n\n${AIDE}`);
    else positionnels.push(a);
  }
  if (positionnels.length !== 2) {
    console.error(AIDE);
    process.exit(1);
  }
  const [recette, nomBrut] = positionnels;
  const nom = nomBrut.trim();
  if (!slug(nom)) echec(`« ${nomBrut} » ne peut pas servir de nom de variante : utilisez des lettres ou des chiffres.`);

  const fichiers = (await readdir(DOSSIER_RECETTES, { recursive: true }))
    .filter((f) => f.endsWith('.gram'))
    .map((f) => path.join(DOSSIER_RECETTES, f))
    .sort();
  const liste = () => fichiers.map((f) => `    ${path.basename(f, '.gram')}`).join('\n');

  // La recette de depart : un nom de fichier (sans .gram) ou un chemin.
  const parChemin = [path.resolve(recette), path.resolve(RACINE, recette)].find((c) => c.endsWith('.gram') && fichiers.includes(c));
  const cle = slug(recette.replace(/\.gram$/, '').split(/[\\/]/).pop());
  const trouves = parChemin ? [parChemin] : fichiers.filter((f) => slug(path.basename(f, '.gram')) === cle);
  if (!trouves.length) echec(`Aucune recette « ${recette} ». Recettes disponibles :\n${liste()}`);
  if (trouves.length > 1) echec(`« ${recette} » est ambigu :\n${trouves.map((f) => `    ${relatif(f)}`).join('\n')}`);
  const depart = trouves[0];

  const source = await readFile(depart, 'utf8');
  const lireEnteteDe = (fichier, texte) => {
    try {
      return lireEntete(texte);
    } catch (err) {
      return echec(`${relatif(fichier)} : ${err.message}`);
    }
  };
  const meta = lireEnteteDe(depart, source);

  // La variante se rattache toujours a l'originale, meme si on part d'une variante.
  let origine = depart;
  let metaOrigine = meta;
  if (meta.variante_de) {
    const slugOrigine = slug(String(meta.variante_de));
    origine = fichiers.find((f) => slug(path.basename(f, '.gram')) === slugOrigine);
    if (!origine) echec(`${relatif(depart)} est une variante de « ${meta.variante_de} », qui n'existe pas.`);
    metaOrigine = lireEnteteDe(origine, await readFile(origine, 'utf8'));
  }
  const nomOrigine = path.basename(origine, '.gram');
  const titreOrigine = String(metaOrigine.title ?? nomOrigine);

  // Dans le dossier de l'originale : les chemins relatifs des `@use` restent valables.
  const cible = path.join(path.dirname(origine), `${nomOrigine}--${slug(nom)}.gram`);
  if (existsSync(cible)) echec(`${relatif(cible)} existe déjà. Choisissez un autre nom, ou modifiez ce fichier.`);

  const entete = [
    `title: ${JSON.stringify(`${titreOrigine} — ${nom}`)}`,
    `date: ${aujourdhui()}`,
    `variante_de: ${slug(nomOrigine)}`,
    `variante: ${JSON.stringify(nom)}`,
    'statut: essai    # essai, retenue ou ecartee',
    `objectif: ${JSON.stringify(objectif.trim())}    # ce que vous cherchez à tester`,
    'verdict: ""    # après dégustation : ce que ça a donné'
  ];
  await writeFile(cible, reecrireEntete(source, entete));

  const copieDe = depart === origine ? '' : `, copiée depuis ${relatif(depart)}`;
  console.log(`✓ ${relatif(cible)}\n`);
  console.log(`  Variante de « ${titreOrigine} »${copieDe}.\n`);
  console.log('Ensuite :');
  console.log('  1. Modifiez le fichier : quantités, temps, étapes…');
  console.log(`  2. Comparez à l'originale :  npx gram diff ${relatif(origine)} ${relatif(cible)}`);
  console.log(`     ou sur le site :          npm run serve   puis   /variantes/${slug(path.basename(cible, '.gram'))}/`);
  console.log('  3. Après dégustation, notez le « verdict » et passez « statut » à retenue ou ecartee.');
}

await main();
