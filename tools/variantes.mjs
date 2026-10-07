// variantes.mjs -- compare une recette et ses variantes, et fabrique les blocs HTML
// correspondants (tableau comparatif, « ce qui change », bandeaux).
//
// Une variante est un fichier .gram qui copie une recette et en change quelque
// chose. Elle se declare par `variante_de: <recette>` dans son en-tete (voir
// tools/variante.mjs, qui cree ce fichier). Ici, pas de lecture de fichier : on
// recoit des « versions » deja compilees :
//
//   { slug, nom, titre, url, statut, objectif, verdict, r, relatif }
//
// ou `r` est le resultat de la compilation Gram (@gram-lang/kitchen + analyzer).

import { formaterQuantite } from '../assets/js/recette.js';
import { aModificateur, esc, formaterDuree, htmlQuantite, lireQuantite, slug, traduireFormule } from './commun.mjs';

const NBSP = ' ';

// --------------------------------------------------------------- statuts

export const STATUTS = {
  essai: { libelle: 'Essai' },
  retenue: { libelle: 'Retenue' },
  ecartee: { libelle: 'Écartée' }
};

const ALIAS_STATUTS = { abandonnee: 'ecartee', rejetee: 'ecartee' };

// Renvoie 'essai' | 'retenue' | 'ecartee', ou null si la valeur est inconnue.
// Un statut absent ou vide vaut 'essai'.
export function normaliserStatut(valeur) {
  if (valeur === undefined || valeur === null || String(valeur).trim() === '') return 'essai';
  const cle = slug(valeur);
  const statut = ALIAS_STATUTS[cle] ?? cle;
  return STATUTS[statut] ? statut : null;
}

// Le statut s'ecrit en toutes lettres, colore : ni pastille, ni icone.
export function texteStatut(statut) {
  return `<span class="statut statut-${statut}">${STATUTS[statut].libelle}</span>`;
}

// ----------------------------------------------------- liste de courses

const nomIngredient = (r, id) => r.registry.ingredients[id]?.name ?? id;

// Cle qui identifie un ingredient d'une version a l'autre.
export function cleIngredient(item) {
  return item.type === 'alternative' ? `alt:${(item.options ?? []).map((o) => o.id).join('|')}` : item.id;
}

function mettreAEchelle(q, facteur, fixe) {
  if (!q || q.texte !== undefined || facteur === 1 || fixe) return q;
  return { ...q, min: q.min * facteur, ...(q.max !== undefined ? { max: q.max * facteur } : {}) };
}

function texteQuantite(q) {
  if (!q) return '';
  if (q.texte !== undefined) return `${q.texte}${q.unite ? NBSP + q.unite : ''}`;
  return formaterQuantite(q.min, q.max, q.unite);
}

// Liste de courses d'une version : cle -> { cle, nom, q, texte, fixe }.
//   q      quantite numerique { min, max?, unite } si l'ingredient n'en a qu'une, sinon null
//   texte  ce qu'on affiche (et compare) : "250 g", "1 c.à.s ou 1 c.à.s", "2 % de farine"...
// `facteur` ramene les quantites a un autre nombre de portions (sauf les quantites fixes).
export function courses(r, facteur = 1) {
  const resultat = new Map();
  for (const item of r.shopping_list) {
    if (aModificateur(item, 'hidden', '-')) continue;
    const cle = cleIngredient(item);

    if (item.type === 'alternative') {
      const options = item.options ?? [];
      const textes = options.map((o) => texteQuantite(mettreAEchelle(lireQuantite(o.qty, o.unit), facteur, o.fixed)));
      resultat.set(cle, {
        cle,
        nom: options.map((o) => nomIngredient(r, o.id)).join(' ou '),
        q: null,
        texte: textes.filter(Boolean).join(' ou '),
        fixe: false
      });
      continue;
    }

    const fixe = Boolean(item.allFixed || item.fixed);
    const q = mettreAEchelle(lireQuantite(item.qty, item.unit), facteur, fixe);
    const morceaux = [];
    if (q) morceaux.push(texteQuantite(q));
    for (const [unite, valeur] of Object.entries(item.otherUnits ?? {})) {
      morceaux.push(texteQuantite(mettreAEchelle({ min: valeur, unite }, facteur, fixe)));
    }
    for (const formule of [...(item.variable_entries ?? []), ...(item.variableParts ?? [])]) {
      morceaux.push(traduireFormule(formule));
    }
    resultat.set(cle, {
      cle,
      nom: item.name ?? nomIngredient(r, item.id),
      q: morceaux.length === 1 && q ? q : null,
      texte: morceaux.join(' + '),
      fixe
    });
  }
  return resultat;
}

// Quantite d'une ligne de courses, ajustable avec les portions (comme dans la liste).
function htmlQuantiteCourses(c) {
  if (!c || !c.texte) return '';
  if (c.q) return htmlQuantite(c.q, { fixe: c.fixe, entier: !c.q.unite });
  return `<span class="qte">${esc(c.texte)}</span>`;
}

// Unites de masse et de volume : 50 cl et 0,5 l sont la meme quantite.
const FAMILLES = {
  mg: ['masse', 0.001],
  g: ['masse', 1],
  kg: ['masse', 1000],
  ml: ['volume', 1],
  cl: ['volume', 10],
  dl: ['volume', 100],
  l: ['volume', 1000]
};

function valeurBase(q) {
  const f = FAMILLES[(q.unite ?? '').toLowerCase()];
  return f ? { famille: f[0], min: q.min * f[1], max: q.max !== undefined ? q.max * f[1] : undefined } : null;
}

const proche = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// Deux lignes de courses disent-elles la meme chose ?
function memeQuantite(a, b) {
  if (a.texte === b.texte) return true;
  if (!a.q || !b.q) return false;
  const x = valeurBase(a.q);
  const y = valeurBase(b.q);
  return Boolean(x && y && x.famille === y.famille && proche(x.min, y.min) && proche(x.max ?? x.min, y.max ?? y.min));
}

function pourcent(a, b) {
  if (!a || !b || a.max !== undefined || b.max !== undefined) return null;
  const x = valeurBase(a);
  const y = valeurBase(b);
  let avant;
  let apres;
  if (x && y && x.famille === y.famille) [avant, apres] = [x.min, y.min];
  else if ((a.unite ?? '').toLowerCase() === (b.unite ?? '').toLowerCase()) [avant, apres] = [a.min, b.min];
  else return null;
  if (!(avant > 0)) return null;
  const p = Math.round(((apres - avant) / avant) * 100);
  return p === 0 ? null : p;
}

const formaterPourcent = (p) => `${p > 0 ? '+' : '−'}${Math.abs(p)}${NBSP}%`;

const portionsDe = (r) => {
  const n = parseInt(r.meta.portions, 10);
  return n > 0 ? n : null;
};

// ---------------------------------------------------------------- etapes

const UNITES_TEMPS = { s: 's', m: 'min', min: 'min', h: 'h', d: 'j' };

function texteMinuteur(t) {
  const unite = UNITES_TEMPS[t.unit] ?? t.unit ?? '';
  const q = lireQuantite(t.quantity);
  let texte = '';
  if (q?.texte !== undefined) texte = q.texte;
  else if (q) {
    texte = q.min.toLocaleString('fr-FR');
    if (q.max !== undefined && q.max !== q.min) texte += ` à ${q.max.toLocaleString('fr-FR')}`;
  }
  return `${texte} ${unite}`.trim();
}

function texteTemperature(t) {
  const q = lireQuantite(t.quantity);
  if (q && q.texte === undefined) return `${q.min.toLocaleString('fr-FR')} ${t.unit ?? ''}`.trim();
  return t.text ?? q?.texte ?? '';
}

// Texte d'une etape, sans balises. `avecQuantite: false` donne la forme qui sert a
// comparer : un simple changement de quantite se voit dans la liste des
// ingredients, il n'a pas a faire apparaitre l'etape comme modifiee.
function texteEtape(r, jetons, avecQuantite) {
  const texteJeton = (j) => {
    if (typeof j === 'string') return j.replace(/\s*\n\s*/g, ' ');
    switch (j.type) {
      case 'timer':
        return texteMinuteur(j);
      case 'temperature':
        return texteTemperature(j);
      case 'comment':
      case 'declaration':
        return '';
      case 'alternative':
        return (j.options ?? []).map(texteJeton).join(' ou ');
      default: {
        if (r.registry.cookware[j.id] && !r.registry.ingredients[j.id]) return j.alias || r.registry.cookware[j.id].name;
        const nom = j.alias || j.name || nomIngredient(r, j.id);
        const q = avecQuantite ? lireQuantite(j.qty, j.unit) : null;
        return q ? `${nom} ${texteQuantite(q)}` : nom;
      }
    }
  };
  // Meme regle d'espacement que le rendu des etapes : Gram retire l'espace apres
  // un element balise, on le remet sauf devant une ponctuation.
  return jetons
    .map((j, i) => {
      let t = texteJeton(j);
      if (typeof j !== 'string' && j.type !== 'comment') {
        const suivant = jetons[i + 1];
        if (suivant !== undefined) {
          const c = typeof suivant === 'string' ? suivant[0] : 'x';
          if (c && !/[.,!?:;)\s…]/.test(c)) t += ' ';
        }
      }
      return t;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function listeEtapes(r) {
  const liste = [];
  for (const section of r.sections) {
    for (const e of section.steps) {
      if (e.type !== 'step') continue;
      const action = e.action ? `[${e.action}] ` : '';
      liste.push({
        section: section.title ?? '',
        cmp: action + texteEtape(r, e.content, false),
        affiche: action + texteEtape(r, e.content, true)
      });
    }
  }
  return liste;
}

// Plus longue sous-suite commune : [{ t: '=', i, j } | { t: '-', i } | { t: '+', j }].
function operations(a, b) {
  const n = a.length;
  const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ t: '=', i: i++, j: j++ });
    else if (t[i + 1][j] >= t[i][j + 1]) ops.push({ t: '-', i: i++ });
    else ops.push({ t: '+', j: j++ });
  }
  while (i < n) ops.push({ t: '-', i: i++ });
  while (j < m) ops.push({ t: '+', j: j++ });
  return ops;
}

const mots = (texte) => texte.split(/\s+/).filter(Boolean);

function similarite(x, y) {
  const a = new Set(mots(x.toLowerCase()));
  const b = new Set(mots(y.toLowerCase()));
  if (!a.size || !b.size) return 0;
  let communs = 0;
  for (const mot of a) if (b.has(mot)) communs++;
  return (2 * communs) / (a.size + b.size);
}

// Mots et signes de ponctuation, chacun avec l'espace qui le precede :
// « beurre, puis » donne beurre / , / puis, pour que « beurre, » et « beurre »
// ne comptent pas comme deux mots differents.
function jetonsTexte(texte) {
  const jetons = [];
  let blanc = '';
  for (const m of texte.matchAll(/(\s+)|([\p{L}\p{N}_’'°%-]+|[^\p{L}\p{N}\s_’'°%-])/gu)) {
    if (m[1]) blanc = m[1];
    else {
      jetons.push({ t: m[2], blanc });
      blanc = '';
    }
  }
  return jetons;
}

// « Cuire 1 min » -> « Cuire 2 min » devient « Cuire <del>1</del> <ins>2</ins> min ».
function htmlDiffMots(avant, apres) {
  const a = jetonsTexte(avant);
  const b = jetonsTexte(apres);
  const sortie = [];
  let sup = [];
  let ins = [];
  const groupe = (jetons, balise) => {
    const texte = jetons.map((j, k) => (k ? j.blanc : '') + j.t).join('');
    return `${esc(jetons[0].blanc)}<${balise}>${esc(texte)}</${balise}>`;
  };
  const vider = () => {
    if (sup.length) sortie.push(groupe(sup, 'del'));
    if (ins.length) sortie.push(groupe(ins, 'ins'));
    sup = [];
    ins = [];
  };
  for (const op of operations(a.map((j) => j.t), b.map((j) => j.t))) {
    if (op.t === '=') {
      vider();
      sortie.push(esc(b[op.j].blanc + b[op.j].t));
    } else if (op.t === '-') sup.push(a[op.i]);
    else ins.push(b[op.j]);
  }
  vider();
  return sortie.join('').trim();
}

function differencesEtapes(a, b) {
  const resultat = [];
  const retrait = (e) => ({ type: 'retire', section: e.section, html: `<del>${esc(e.affiche)}</del>` });
  let retirees = [];
  let ajoutees = [];

  // Les etapes retirees et ajoutees au meme endroit qui se ressemblent sont
  // presentees comme une etape modifiee ; les autres comme retrait / ajout.
  const vider = () => {
    let debut = 0;
    for (const ajout of ajoutees) {
      let trouve = -1;
      for (let k = debut; k < retirees.length; k++) {
        if (similarite(retirees[k].cmp, ajout.cmp) >= 0.5) {
          trouve = k;
          break;
        }
      }
      if (trouve < 0) {
        resultat.push({ type: 'ajoute', section: ajout.section, html: `<ins>${esc(ajout.affiche)}</ins>` });
        continue;
      }
      for (let k = debut; k < trouve; k++) resultat.push(retrait(retirees[k]));
      resultat.push({ type: 'modifie', section: ajout.section, html: htmlDiffMots(retirees[trouve].cmp, ajout.cmp) });
      debut = trouve + 1;
    }
    for (let k = debut; k < retirees.length; k++) resultat.push(retrait(retirees[k]));
    retirees = [];
    ajoutees = [];
  };

  for (const op of operations(a.map((e) => e.cmp), b.map((e) => e.cmp))) {
    if (op.t === '=') vider();
    else if (op.t === '-') retirees.push(a[op.i]);
    else ajoutees.push(b[op.j]);
  }
  vider();
  return resultat;
}

// ----------------------------------------------------------- differences

// Ce que `variante` change par rapport a `originale` (deux « versions »).
// Les quantites des deux versions sont comparees pour le nombre de portions de
// l'originale : une variante ecrite pour 6 portions au lieu de 4 n'apparait pas
// entierement modifiee.
export function differences(originale, variante) {
  const pO = portionsDe(originale.r);
  const pV = portionsDe(variante.r);
  const memePortions = !pO || !pV || pO === pV;

  const cO = courses(originale.r);
  const cV = courses(variante.r, memePortions ? 1 : pO / pV);
  // Pour marquer la liste de la variante : l'originale a l'echelle de la variante.
  const cOEchelleV = courses(originale.r, memePortions ? 1 : pV / pO);

  const ingredients = [];
  const marques = new Map();
  for (const [cle, a] of cO) {
    const b = cV.get(cle);
    if (!b) ingredients.push({ type: 'retire', nom: a.nom, avant: a });
    else if (!memeQuantite(a, b)) {
      ingredients.push({ type: 'modifie', nom: b.nom, avant: a, apres: b, pourcent: pourcent(a.q, b.q) });
      marques.set(cle, { type: 'modifie', avantHtml: htmlQuantiteCourses(cOEchelleV.get(cle)) });
    }
  }
  for (const [cle, b] of cV) {
    if (cO.has(cle)) continue;
    ingredients.push({ type: 'ajoute', nom: b.nom, apres: b });
    marques.set(cle, { type: 'ajoute' });
  }

  const etapes = differencesEtapes(listeEtapes(originale.r), listeEtapes(variante.r));

  const portions = pO !== pV ? { avant: pO, apres: pV } : null;
  const donneA = originale.r.meta.makes ?? '';
  const donneV = variante.r.meta.makes ?? '';
  const donne = String(donneA) !== String(donneV) ? { avant: String(donneA), apres: String(donneV) } : null;
  const tA = Math.round(originale.r.metrics.totalTime ?? 0);
  const tV = Math.round(variante.r.metrics.totalTime ?? 0);
  const temps = tA !== tV ? { avant: tA, apres: tV } : null;

  return {
    ingredients,
    etapes,
    portions,
    donne,
    temps,
    marques,
    portionsReference: pO,
    ramenee: !memePortions,
    identique: !ingredients.length && !etapes.length && !portions && !donne && !temps
  };
}

// Quelques mots par changement, pour les fiches de la liste des versions.
function resumeCourt(diff) {
  const resume = [];
  for (const i of diff.ingredients) {
    if (i.type === 'modifie') resume.push(`${i.nom} : ${i.avant.texte || '—'} → ${i.apres.texte || '—'}`);
    else if (i.type === 'ajoute') resume.push(`+ ${i.nom}`);
    else resume.push(`− ${i.nom}`);
  }
  if (diff.portions) resume.push(`portions : ${diff.portions.avant ?? '—'} → ${diff.portions.apres ?? '—'}`);
  const n = diff.etapes.length;
  if (n) resume.push(`${n} étape${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}`);
  if (diff.temps) resume.push(`temps total : ${formaterDuree(diff.temps.avant) || '—'} → ${formaterDuree(diff.temps.apres) || '—'}`);
  return resume;
}

// Phrase courte pour la description de la page d'une variante.
export function descriptionVariante(racine, diff) {
  const resume = resumeCourt(diff);
  if (!resume.length) return `Variante de ${racine.titre}.`;
  return `Variante de ${racine.titre} : ${resume.slice(0, 3).join(' ; ')}${resume.length > 3 ? '…' : ''}`;
}

// ------------------------------------------------------------------ HTML

const paragraphes = (texte) => esc(String(texte).trim()).replace(/\n+/g, '<br>');

// En haut de la page d'une variante.
export function bandeauVariante(v, racine) {
  const lignes = [
    `<p class="variante-de">Variante de <a href="${esc(racine.url)}">${esc(racine.titre)}</a> · ${texteStatut(v.statut)}</p>`
  ];
  if (v.objectif) lignes.push(`<p><strong>Objectif</strong> : ${paragraphes(v.objectif)}</p>`);
  if (v.verdict) lignes.push(`<p><strong>Verdict</strong> : ${paragraphes(v.verdict)}</p>`);
  return `<div class="variante-bandeau">\n${lignes.join('\n')}\n</div>`;
}

// En haut de la page d'une recette dont une variante est retenue.
export function bandeauRetenue(variantes) {
  const retenues = variantes.filter((v) => v.statut === 'retenue');
  if (!retenues.length) return '';
  const lignes = retenues.map(
    (v) =>
      `<p><strong>Version retenue</strong> : <a href="${esc(v.url)}">${esc(v.nom)}</a>` +
      `${v.verdict ? ` — ${esc(String(v.verdict).trim().replace(/\s*\n+\s*/g, ' '))}` : ''}</p>`
  );
  return `<div class="variante-bandeau">\n${lignes.join('\n')}\n</div>`;
}

const texteOuTiret = (c) => (c?.texte ? esc(c.texte) : '—');

// « Ce qui change » : le detail, ligne par ligne, par rapport a l'originale.
export function blocChangements(diff, racine, idTitre, fichier) {
  const entete =
    `<h2 id="${idTitre}">Ce qui change</h2>\n` +
    `<p class="changements-intro">Par rapport à <a href="${esc(racine.url)}">la recette originale</a>.</p>`;
  if (diff.identique) {
    return (
      `${entete}\n<p class="changements-vide">Aucune différence pour l’instant. ` +
      `Modifiez <code>${esc(fichier)}</code> : les changements apparaîtront ici.</p>`
    );
  }

  const lignes = [];
  const ligne = (type, html) => lignes.push(`  <li class="chg chg-${type}">${html}</li>`);

  if (diff.portions) {
    ligne('modifie', `<span class="chg-nom">portions</span> <del>${diff.portions.avant ?? '—'}</del> → <ins>${diff.portions.apres ?? '—'}</ins>`);
  }
  if (diff.donne) {
    ligne('modifie', `<span class="chg-nom">donne</span> <del>${esc(diff.donne.avant || '—')}</del> → <ins>${esc(diff.donne.apres || '—')}</ins>`);
  }
  if (diff.temps) {
    ligne(
      'modifie',
      `<span class="chg-nom">temps total</span> <del>${esc(formaterDuree(diff.temps.avant) || '—')}</del> → <ins>${esc(formaterDuree(diff.temps.apres) || '—')}</ins>`
    );
  }
  for (const i of diff.ingredients) {
    if (i.type === 'modifie') {
      const p = i.pourcent !== null ? ` <span class="chg-pct">${formaterPourcent(i.pourcent)}</span>` : '';
      ligne('modifie', `<span class="chg-nom">${esc(i.nom)}</span> <del>${texteOuTiret(i.avant)}</del> → <ins>${texteOuTiret(i.apres)}</ins>${p}`);
    } else if (i.type === 'ajoute') {
      ligne('ajoute', `<span class="chg-signe">+</span> <ins>${esc(i.nom)}${i.apres.texte ? ` ${esc(i.apres.texte)}` : ''}</ins>`);
    } else {
      ligne('retire', `<span class="chg-signe">−</span> <del>${esc(i.nom)}${i.avant.texte ? ` ${esc(i.avant.texte)}` : ''}</del>`);
    }
  }

  const morceaux = [entete];
  if (diff.ramenee && diff.portionsReference) {
    morceaux.push(`<p class="changements-note">Quantités comparées pour ${diff.portionsReference} portions, celles de l’originale.</p>`);
  }
  if (lignes.length) morceaux.push(`<ul class="changements">\n${lignes.join('\n')}\n</ul>`);

  if (diff.etapes.length) {
    const etapes = diff.etapes.map((e) => {
      const section = e.section ? `<span class="chg-section">${esc(e.section)}</span> ` : '';
      const signe = e.type === 'ajoute' ? '<span class="chg-signe">+</span> ' : e.type === 'retire' ? '<span class="chg-signe">−</span> ' : '';
      return `  <li class="chg chg-${e.type}">${section}${signe}${e.html}</li>`;
    });
    morceaux.push(`<p class="chg-titre">Étapes</p>\n<ul class="changements changements-etapes">\n${etapes.join('\n')}\n</ul>`);
  }
  return morceaux.join('\n');
}

// Cellule du tableau : le texte de la version, en evidence s'il differe de l'originale.
function cellule(c, reference, estOriginale) {
  if (!c) return `<td class="absent${!estOriginale && reference ? ' diff' : ''}">—</td>`;
  const diff = !estOriginale && (!reference || !memeQuantite(reference, c));
  const contenu = c.texte ? `<span class="qte">${esc(c.texte)}</span>` : '<span class="ing-detail">oui</span>';
  return `<td${diff ? ' class="diff"' : ''}>${contenu}</td>`;
}

// « Variantes » / « Toutes les versions » : fiches des versions et tableau comparatif.
// `courant` est la version affichee sur la page (null pour la page de l'originale).
export function blocVersions({ racine, variantes, courant, idTitre }) {
  const versions = [racine, ...variantes];
  const estCourante = (v) => (courant ? v.slug === courant.slug : v === racine);
  const diffs = new Map(variantes.map((v) => [v.slug, differences(racine, v)]));

  // --- fiches
  const fiches = versions.map((v) => {
    const classes = ['version'];
    if (estCourante(v)) classes.push('courant');
    const tete = [estCourante(v) ? `<strong>${esc(v.nom)}</strong>` : `<a href="${esc(v.url)}">${esc(v.nom)}</a>`];
    if (v !== racine) tete.push(texteStatut(v.statut));
    if (estCourante(v)) tete.push('<span class="ing-detail">vous êtes ici</span>');
    const morceaux = [`<div class="version-tete">${tete.join(' · ')}</div>`];
    if (v === racine) morceaux.push(`<p class="version-info">${esc(v.titre)}</p>`);
    else {
      if (v.objectif) morceaux.push(`<p class="version-info"><strong>Objectif</strong> : ${paragraphes(v.objectif)}</p>`);
      if (v.verdict) morceaux.push(`<p class="version-info"><strong>Verdict</strong> : ${paragraphes(v.verdict)}</p>`);
      const resume = resumeCourt(diffs.get(v.slug));
      if (resume.length) {
        const shown = resume.slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('');
        morceaux.push(`<ul class="version-resume">${shown}${resume.length > 4 ? '<li>…</li>' : ''}</ul>`);
      } else morceaux.push('<p class="version-info ing-detail">Identique à l’originale pour l’instant.</p>');
    }
    return `  <li class="${classes.join(' ')}">\n    ${morceaux.join('\n    ')}\n  </li>`;
  });

  // --- tableau
  const pRef = portionsDe(racine.r);
  const parVersion = versions.map((v) => {
    const pV = portionsDe(v.r);
    return courses(v.r, v !== racine && pRef && pV && pRef !== pV ? pRef / pV : 1);
  });
  const ramenees = variantes.some((v) => {
    const pV = portionsDe(v.r);
    return pRef && pV && pRef !== pV;
  });

  const cles = [];
  const noms = new Map();
  for (const liste of parVersion) {
    for (const [cle, c] of liste) {
      if (!noms.has(cle)) {
        noms.set(cle, c.nom);
        cles.push(cle);
      }
    }
  }

  const entetes = versions.map((v) => {
    const nom = v === racine ? 'Originale' : v.nom;
    const contenu = estCourante(v) ? esc(nom) : `<a href="${esc(v.url)}">${esc(nom)}</a>`;
    const statut = v === racine ? '' : texteStatut(v.statut);
    return `<th scope="col"${estCourante(v) ? ' class="courant"' : ''}>${contenu}${statut}</th>`;
  });

  // Seules les lignes qui different d'une version a l'autre sont affichees : le
  // reste (les ingredients communs) allongerait le tableau sans rien apprendre.
  const lignes = [];
  const portionsDefinies = versions.map((v) => portionsDe(v.r));
  if (portionsDefinies.some((p, k) => k > 0 && p !== portionsDefinies[0])) {
    const cases = portionsDefinies.map((p, k) => `<td${k > 0 && p !== portionsDefinies[0] ? ' class="diff"' : ''}>${p ?? '—'}</td>`);
    lignes.push(`    <tr><th scope="row">Portions</th>${cases.join('')}</tr>`);
  }
  let identiques = 0;
  for (const cle of cles) {
    const reference = parVersion[0].get(cle);
    const differe = parVersion.some((liste, k) => {
      if (k === 0) return false;
      const c = liste.get(cle);
      return c ? !reference || !memeQuantite(reference, c) : Boolean(reference);
    });
    if (!differe) {
      identiques++;
      continue;
    }
    const cases = parVersion.map((liste, k) => cellule(liste.get(cle), reference, k === 0));
    lignes.push(`    <tr><th scope="row">${esc(noms.get(cle))}</th>${cases.join('')}</tr>`);
  }
  const temps = versions.map((v) => Math.round(v.r.metrics.totalTime ?? 0));
  if (temps.some((t, k) => k > 0 && t !== temps[0])) {
    const cases = temps.map((t, k) => `<td${k > 0 && t !== temps[0] ? ' class="diff"' : ''}>${esc(formaterDuree(t) || '—')}</td>`);
    lignes.push(`    <tr><th scope="row">Temps total</th>${cases.join('')}</tr>`);
  }

  const reste = identiques
    ? ` ${identiques} ingrédient${identiques > 1 ? 's' : ''} identique${identiques > 1 ? 's' : ''} dans toutes les versions ne ${identiques > 1 ? 'sont' : 'est'} pas affiché${identiques > 1 ? 's' : ''}.`
    : '';
  const legende = pRef
    ? `Ce qui diffère de l’originale, pour ${pRef} portions${ramenees ? ' (celles de l’originale ; les versions écrites pour un autre nombre de portions sont ramenées à celui-ci)' : ''}.${reste}`
    : `Ce qui diffère de l’originale, quantités telles qu’écrites dans chaque version.${reste}`;
  const tableau = lignes.length
    ? `<details class="versions-comparaison">\n` +
      `<summary><span class="ouvrir">Afficher la comparaison</span><span class="fermer">Masquer la comparaison</span></summary>\n\n` +
      `<p class="versions-legende">${legende}</p>\n\n` +
      `<table class="versions-tableau">\n  <thead>\n    <tr><th scope="col"></th>${entetes.join('')}</tr>\n  </thead>\n  <tbody>\n${lignes.join('\n')}\n  </tbody>\n</table>\n</details>`
    : '<p class="versions-legende">Les versions ont les mêmes ingrédients, aux mêmes quantités.</p>';

  return (
    `<h2 id="${idTitre}">${courant ? 'Toutes les versions' : 'Variantes'}</h2>\n` +
    `<ul class="versions-liste">\n${fiches.join('\n')}\n</ul>\n\n` +
    tableau
  );
}
