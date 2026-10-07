// commun.mjs -- fonctions partagees par le generateur de pages (gram-jekyll.mjs)
// et par les outils de variantes (variantes.mjs, variante.mjs).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { formaterNombre, formaterQuantite } from '../assets/js/recette.js';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function slug(texte) {
  return String(texte)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function git(...args) {
  try {
    return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export const enListe = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);

// "de citrons", "d'œufs"
export const de = (nom) => (/^[aeiouyhœæàâéèêëîïôûù]/i.test(nom) ? `d’${nom}` : `de ${nom}`);

export const aModificateur = (u, nom, symbole) => (u.modifiers ?? []).some((m) => m === nom || m === symbole);

// 1 h 19 min, 45 min, 1 j 2 h
export function formaterDuree(minutes) {
  if (!minutes || minutes < 0) return '';
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  let reste = Math.round(minutes);
  const jours = Math.floor(reste / 1440);
  reste -= jours * 1440;
  const heures = Math.floor(reste / 60);
  reste -= heures * 60;
  const morceaux = [];
  if (jours) morceaux.push(`${jours} j`);
  if (heures) morceaux.push(`${heures} h`);
  if (reste) morceaux.push(`${reste} min`);
  return morceaux.join(' ');
}

// Anticipation d'une section (~{-1d}) : "la veille", "2 jours avant", "3 h avant".
export function formaterAnticipation(minutes) {
  const m = Math.abs(minutes);
  if (m === 1440) return 'la veille';
  if (m % 1440 === 0) return `${m / 1440} jours avant`;
  return `${formaterDuree(m)} avant`;
}

// ------------------------------------------------------------ quantites

// Ramene les differentes formes de quantite produites par Gram a
// { min, max?, unite } (valeur numerique, donc ajustable) ou { texte, unite }.
export function lireQuantite(qte, unite) {
  if (qte === undefined || qte === null || qte === '') return null;
  if (typeof qte === 'number') return { min: qte, unite };
  if (typeof qte === 'string') {
    const n = Number(qte.replace(',', '.'));
    return Number.isFinite(n) ? { min: n, unite } : { texte: qte, unite };
  }
  switch (qte.type) {
    case 'single':
    case 'fraction':
      return { min: qte.value, unite };
    case 'range':
      return { min: qte.range.min, max: qte.range.max, unite };
    case 'RelativeQuantity':
      return { texte: `${formaterNombre(qte.percent)} % de ${qte.target}` };
    case 'TextQuantity':
      return { texte: qte.value, unite };
    default:
      return qte.text ? { texte: qte.text, unite } : null;
  }
}

export function htmlQuantite(q, { fixe = false, entier = false } = {}) {
  if (!q) return '';
  if (q.texte !== undefined) {
    return `<span class="qte">${esc(q.texte)}${q.unite ? ` ${esc(q.unite)}` : ''}</span>`;
  }
  const attributs = [`data-u="${esc(q.unite ?? '')}"`];
  if (q.max !== undefined && q.max !== q.min) attributs.push(`data-min="${q.min}"`, `data-max="${q.max}"`);
  else attributs.push(`data-v="${q.min}"`);
  if (fixe) attributs.push('data-fixe');
  if (entier) attributs.push('data-entier');
  return `<span class="qte" ${attributs.join(' ')}>${esc(formaterQuantite(q.min, q.max, q.unite))}</span>`;
}

// "70% of farine T65" (quantite relative non resolue) -> "70 % de farine T65"
export const traduireFormule = (f) => f.replace(/(\d+(?:[.,]\d+)?)\s*% of /g, '$1 % de ');


// En-tete YAML d'un fichier .gram ({} s'il n'y en a pas). Un en-tete invalide
// leve une erreur : l'ignorer en silence ferait perdre des champs comme
// `variante_de` et changerait la nature de la recette sans prevenir.
export function lireEntete(source) {
  const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!entete) return {};
  try {
    return YAML.parse(entete[1]) ?? {};
  } catch (err) {
    throw new Error(`en-tête illisible (YAML) : ${err.message.split('\n')[0]}`);
  }
}

export async function lireYaml(fichier) {
  if (!existsSync(fichier)) return {};
  return YAML.parse(await readFile(fichier, 'utf8')) ?? {};
}
