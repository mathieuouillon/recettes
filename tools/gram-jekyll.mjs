#!/usr/bin/env node
// gram-jekyll.mjs -- transforme les recettes Gram en articles Jekyll (theme Chirpy).
//
//   npm run recettes   -> compile recettes/**/*.gram vers _posts/gram/
//   npm run verifier   -> compile sans rien ecrire (code de sortie 1 en cas d'erreur)
//
// Chaque fichier .gram passe par le pipeline officiel de Gram (@gram-lang/cli :
// lecture, modules @use, compilation, analyse des masses), puis le JSON obtenu
// est rendu en HTML francais pour Chirpy. Le dossier _posts/gram/ est regenere
// entierement a chaque passage : on ne le modifie jamais a la main.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runPipeline } from '@gram-lang/cli';
import { warningSeverityOf } from '@gram-lang/modules';
import { getAST } from '@gram-lang/parser';
import YAML from 'yaml';

import {
  RACINE,
  aModificateur,
  de,
  enListe,
  esc,
  formaterAnticipation,
  formaterDuree,
  git,
  htmlQuantite,
  lireEntete,
  lireQuantite,
  lireYaml,
  slug,
  traduireFormule
} from './commun.mjs';
import {
  bandeauRetenue,
  bandeauVariante,
  blocChangements,
  blocVersions,
  cleIngredient,
  descriptionVariante,
  differences,
  normaliserStatut
} from './variantes.mjs';
const DOSSIER_RECETTES = path.join(RACINE, 'recettes');
const DOSSIER_POSTS = path.join(RACINE, '_posts', 'gram');
const DOSSIER_VARIANTES = path.join(RACINE, '_variantes');
const VERIFIER_SEULEMENT = process.argv.includes('--verifier');

// Avertissements qui signalent seulement une base d'ingredients incomplete
// (nutrition, densites) : sans interet tant qu'on n'en maintient pas une.
const CODES_BASE_INGREDIENTS = new Set(['MISSING_INGREDIENT', 'MISSING_MACROS', 'UNKNOWN_MASS']);

const UNITES_TEMPS = { s: 's', m: 'min', min: 'min', h: 'h', d: 'j' };

const GRAVITES = { error: 'erreur', warning: 'attention', info: 'info' };

// ---------------------------------------------------------------- outils

// ------------------------------------------------------------- rendu HTML

class Rendu {
  constructor(recette, contexte) {
    this.r = recette;
    this.ctx = contexte;
    this.ids = new Set();
  }

  id(texte) {
    const base = slug(texte) || 'section';
    let id = base;
    for (let i = 2; this.ids.has(id); i++) id = `${base}-${i}`;
    this.ids.add(id);
    return id;
  }

  nomIngredient(id) {
    return this.r.registry.ingredients[id]?.name ?? id;
  }

  nomUstensile(id) {
    return this.r.registry.cookware[id]?.name ?? id;
  }

  estUstensile(u) {
    return Boolean(this.r.registry.cookware[u.id]) && !this.r.registry.ingredients[u.id];
  }

  estIntermediaire(u) {
    return u.type === 'reference' || Boolean(this.r.registry.ingredients[u.id]?.is_intermediate);
  }

  // --- jetons des etapes

  jeton(j) {
    if (typeof j === 'string') return esc(j.replace(/\s*\n\s*/g, ' '));
    switch (j.type) {
      case 'timer':
        return this.minuteur(j);
      case 'temperature':
        return this.temperature(j);
      case 'comment':
        return `<span class="commentaire">${esc(j.value)}</span>`;
      case 'declaration':
        return `<span class="declaration" title="Résultat réutilisé plus loin"><i class="fas fa-arrow-right" aria-hidden="true"></i> ${esc(j.name)}</span>`;
      case 'alternative':
        return (j.options ?? []).map((o) => this.jeton(o)).join(' <span class="ou">ou</span> ');
      default:
        if (this.estUstensile(j)) return `<span class="ustensile">${esc(j.alias || this.nomUstensile(j.id))}</span>`;
        return this.ingredientEnLigne(j);
    }
  }

  ingredientEnLigne(u) {
    const intermediaire = this.estIntermediaire(u);
    const nom = u.alias || u.name || this.nomIngredient(u.id);
    const q = lireQuantite(u.qty, u.unit);
    const classe = intermediaire ? 'intermediaire' : 'ing';
    const quantite = q ? ` <span class="ing-q">${htmlQuantite(q, { fixe: u.fixed })}</span>` : '';
    const titre = [u.preparation, aModificateur(u, 'optional', '?') ? 'facultatif' : null].filter(Boolean).join(', ');
    return `<span class="${classe}"${titre ? ` title="${esc(titre)}"` : ''}>${esc(nom)}${quantite}</span>`;
  }

  minuteur(t) {
    const unite = UNITES_TEMPS[t.unit] ?? t.unit ?? '';
    const q = lireQuantite(t.quantity);
    let texte = '';
    if (q?.texte !== undefined) texte = q.texte;
    else if (q) {
      texte = q.min.toLocaleString('fr-FR');
      if (q.max !== undefined && q.max !== q.min) texte += ` à ${q.max.toLocaleString('fr-FR')}`;
    }
    const titre = t.isPassive ? 'Attente : vous êtes libre pendant ce temps' : 'Temps de travail actif';
    const icone = t.isPassive ? 'hourglass-half' : 'stopwatch';
    return `<span class="minuteur${t.isPassive ? ' passif' : ''}" title="${titre}"><i class="fas fa-${icone}" aria-hidden="true"></i> ${esc(texte)} ${esc(unite)}</span>`;
  }

  temperature(t) {
    const q = lireQuantite(t.quantity);
    if (q && q.texte === undefined) {
      const valeur = q.min.toLocaleString('fr-FR');
      return `<span class="temperature"><i class="fas fa-temperature-half" aria-hidden="true"></i> ${esc(valeur)} ${esc(t.unit ?? '')}</span>`;
    }
    return `<span class="temperature"><i class="fas fa-fire-flame-curved" aria-hidden="true"></i> ${esc(t.text ?? q?.texte ?? '')}</span>`;
  }

  // Gram retire l'espace qui suit un element balise ; on le remet sauf
  // devant une ponctuation (meme regle que @gram-lang/renderer).
  jetons(liste) {
    return liste
      .map((j, i) => {
        let html = this.jeton(j);
        if (typeof j !== 'string' && j.type !== 'comment') {
          const suivant = liste[i + 1];
          if (suivant !== undefined) {
            const c = typeof suivant === 'string' ? suivant[0] : 'x';
            if (c && !/[.,!?:;)\s…]/.test(c)) html += ' ';
          }
        }
        return html;
      })
      .join('');
  }

  // --- blocs

  fiche() {
    const { meta, metrics } = this.r;
    const portions = parseInt(meta.portions, 10);
    const reglage =
      portions > 0
        ? `<span class="reglage-portions" data-base="${portions}" data-pas="1">`
        : `<span class="reglage-portions" data-base="1" data-pas="0.5" data-prefixe="× ">`;
    const boutons =
      `${reglage}<button type="button" class="portions-moins" aria-label="Diminuer">−</button>` +
      `<output>${portions > 0 ? portions : '× 1'}</output>` +
      `<button type="button" class="portions-plus" aria-label="Augmenter">+</button>` +
      `<button type="button" class="portions-reset" hidden>initial</button></span>`;

    const cases = [
      ['fa-user-group', portions > 0 ? 'Portions' : 'Quantités', boutons]
    ];
    const travail = (metrics.preparationTime ?? 0) + (metrics.activeTime ?? 0);
    if (travail) cases.push(['fa-hand', 'Préparation', formaterDuree(travail)]);
    if (metrics.idleTime) cases.push(['fa-hourglass-half', 'Attente', formaterDuree(metrics.idleTime)]);
    if (metrics.totalTime) cases.push(['fa-clock', 'Temps total', formaterDuree(metrics.totalTime)]);
    const anticipations = this.r.sections.map((s) => s.retro_planning?.minutes).filter((m) => m < 0);
    if (anticipations.length) {
      cases.push(['fa-calendar-day', 'À commencer', formaterAnticipation(Math.min(...anticipations))]);
    }
    if (meta.makes) cases.push(['fa-cookie-bite', 'Donne', esc(meta.makes)]);

    return (
      '<div class="fiche-recette">\n' +
      cases
        .map(
          ([icone, titre, valeur]) =>
            `  <div class="fiche-case"><span class="fiche-titre"><i class="fas ${icone}" aria-hidden="true"></i> ${titre}</span><span class="fiche-valeur">${valeur}</span></div>`
        )
        .join('\n') +
      '\n</div>'
    );
  }

  elementCourses(item) {
    if (item.type === 'alternative') {
      return (item.options ?? [])
        .map((o) => {
          const q = lireQuantite(o.qty, o.unit);
          return `<span class="ing-nom">${esc(this.nomIngredient(o.id))}</span>${q ? ` ${htmlQuantite(q, { fixe: o.fixed })}` : ''}`;
        })
        .join(' <span class="ou">ou</span> ');
    }
    const nom = item.name ?? this.nomIngredient(item.id);
    const morceaux = [`<span class="ing-nom">${esc(nom)}</span>`];
    const q = lireQuantite(item.qty, item.unit);
    // Sans unite, c'est un nombre de pieces a acheter : on arrondit au-dessus.
    if (q) morceaux.push(htmlQuantite(q, { fixe: item.allFixed || item.fixed, entier: !item.unit }));
    for (const [unite, valeur] of Object.entries(item.otherUnits ?? {})) {
      morceaux.push(`+ ${htmlQuantite({ min: valeur, unite })}`);
    }
    for (const formule of [...(item.variable_entries ?? []), ...(item.variableParts ?? [])]) {
      morceaux.push(`<span class="qte">${esc(traduireFormule(formule))}</span>`);
    }
    if (item.type === 'composite') {
      const parties = item.usage
        .map((u) => (u.alias === 'Direct Use' ? 'entiers' : this.nomIngredient(u.id)))
        .filter(Boolean);
      if (parties.length) morceaux.push(`<span class="ing-detail">${esc(parties.join(' + '))}</span>`);
    }
    if (aModificateur(item, 'optional', '?')) morceaux.push('<span class="ing-detail">facultatif</span>');
    return morceaux.join(' ');
  }

  ingredients() {
    const items = this.r.shopping_list.filter((i) => !aModificateur(i, 'hidden', '-'));
    if (!items.length) return '';
    const lignes = items.map((i) => {
      // Sur la page d'une variante : ce qui change par rapport a l'originale.
      const marque = this.ctx.marques?.get(cleIngredient(i));
      const classe = marque ? ` class="ing-${marque.type}"` : '';
      const note =
        marque?.type === 'ajoute'
          ? ' <span class="badge-nouveau">nouveau</span>'
          : marque?.avantHtml
            ? ` <span class="avant">(avant : ${marque.avantHtml})</span>`
            : '';
      return `  <li${classe}><label><input type="checkbox"> ${this.elementCourses(i)}${note}</label></li>`;
    });
    return `<h2 id="${this.id('ingredients')}">Ingrédients</h2>\n<ul class="liste-ingredients">\n${lignes.join('\n')}\n</ul>`;
  }

  materiel() {
    const vus = new Set();
    const items = this.r.cookware.filter((u) => {
      if (aModificateur(u, 'hidden', '-') || aModificateur(u, 'reference', '&') || vus.has(u.id)) return false;
      vus.add(u.id);
      return true;
    });
    if (!items.length) return '';
    const lignes = items.map((u) => {
      const q = lireQuantite(u.qty);
      const nombre = q && q.min !== 1 ? `${htmlQuantite(q, { fixe: u.fixed, entier: true })} ` : '';
      const precision = u.preparation ? ` <span class="ing-detail">${esc(u.preparation)}</span>` : '';
      const facultatif = aModificateur(u, 'optional', '?') ? ' <span class="ing-detail">facultatif</span>' : '';
      return `  <li>${nombre}${esc(this.nomUstensile(u.id))}${precision}${facultatif}</li>`;
    });
    return `<h2 id="${this.id('materiel')}">Matériel</h2>\n<ul class="liste-materiel">\n${lignes.join('\n')}\n</ul>`;
  }

  miseEnPlace(section) {
    const lignes = section.ingredients
      .filter((u) => !aModificateur(u, 'hidden', '-'))
      .map((u) => {
        if (u.type === 'alternative') return `<li>${this.elementCourses(u)}</li>`;
        const intermediaire = this.estIntermediaire(u);
        const nom = u.name ?? this.nomIngredient(u.id);
        const q = lireQuantite(u.qty, u.unit);
        const details = [];
        if (u.composite?.parent) details.push(de(u.composite.parent));
        if (u.preparation) details.push(u.preparation);
        return (
          `<li><span class="${intermediaire ? 'intermediaire' : 'ing-nom'}">${esc(nom)}</span>` +
          `${q ? ` ${htmlQuantite(q, { fixe: u.fixed })}` : ''}` +
          `${details.length ? ` <span class="ing-detail">${esc(details.join(', '))}</span>` : ''}</li>`
        );
      });
    return lignes.length ? `<ul class="mise-en-place">${lignes.join('')}</ul>` : '';
  }

  section(section, plusieurs) {
    const morceaux = [];
    if (section.title) {
      const badges = [];
      if (section.retro_planning?.minutes < 0) {
        badges.push(`<span class="badge-section"><i class="fas fa-calendar-day" aria-hidden="true"></i> ${formaterAnticipation(section.retro_planning.minutes)}</span>`);
      }
      if (section.module) {
        const cible = this.ctx.urlDe(section.module.uri);
        const titre = esc(section.module.title ?? section.module.binding);
        badges.push(`<span class="badge-section"><i class="fas fa-puzzle-piece" aria-hidden="true"></i> base : ${cible ? `<a href="${cible}">${titre}</a>` : titre}</span>`);
      }
      morceaux.push(`<h3 id="${this.id(section.title)}">${esc(section.title)}${badges.length ? ` ${badges.join(' ')}` : ''}</h3>`);
    }
    if (plusieurs) morceaux.push(this.miseEnPlace(section));

    const etapes = section.steps.map((e) => {
      if (e.type === 'comment') return `  <li class="sans-numero"><span class="commentaire">${esc(e.value)}</span></li>`;
      const action = e.action ? `<strong class="action">${esc(e.action)}</strong> ` : '';
      return `  <li>${action}${this.jetons(e.content)}</li>`;
    });
    morceaux.push(`<ol class="etapes">\n${etapes.join('\n')}\n</ol>`);
    if (section.intermediate_preparation) {
      morceaux.push(`<p class="resultat-section"><i class="fas fa-arrow-right" aria-hidden="true"></i> donne : <span class="intermediaire">${esc(section.intermediate_preparation)}</span></p>`);
    }
    return morceaux.filter(Boolean).join('\n');
  }

  preparation() {
    const sections = this.r.sections.filter((s) => s.steps.length);
    const plusieurs = sections.length > 1;
    return `<h2 id="${this.id('preparation')}">Préparation</h2>\n${sections.map((s) => this.section(s, plusieurs)).join('\n')}`;
  }

  notes() {
    const { meta } = this.r;
    const morceaux = enListe(meta.notes).map((n) => `<p>${esc(n)}</p>`);
    const auteurs = enListe(meta.author);
    if (auteurs.length) morceaux.push(`<p class="recette-info">Recette de ${esc(auteurs.join(', '))}.</p>`);
    const sources = enListe(meta.source);
    if (sources.length) {
      const liens = sources.map((s) => (/^https?:\/\//.test(s) ? `<a href="${esc(s)}">${esc(new URL(s).hostname.replace(/^www\./, ''))}</a>` : esc(s)));
      morceaux.push(`<p class="recette-info">Source : ${liens.join(', ')}.</p>`);
    }
    return morceaux.length ? `<h2 id="${this.id('notes')}">Notes</h2>\n${morceaux.join('\n')}` : '';
  }

  sourceGram() {
    const { chemin, contenu } = this.ctx;
    // Le bouton est branche par assets/js/recette.js, qui telecharge le texte
    // du bloc ci-dessous : Jekyll ne sait pas servir un .gram tel quel (il
    // traiterait son en-tete --- comme un front matter).
    return (
      `<details class="source-gram">\n<summary><i class="fas fa-code" aria-hidden="true"></i> Le fichier Gram de cette recette</summary>\n` +
      `<p><button type="button" class="telecharger-gram" data-nom="${esc(path.basename(chemin))}"><i class="fas fa-download" aria-hidden="true"></i> ${esc(path.basename(chemin))}</button> · écrit en <a href="https://gram-lang.org/fr/">Gram</a></p>\n` +
      `<pre><code>${colorerGram(contenu)}</code></pre>\n</details>`
    );
  }

  // Blocs propres aux variantes (ctx.bandeau, ctx.changements, ctx.versions) ;
  // chacun est un texte ou une fonction qui recoit l'id de son titre.
  bloc(contenu, nomId) {
    return typeof contenu === 'function' ? contenu(this.id(nomId)) : (contenu ?? '');
  }

  page() {
    const ctx = this.ctx;
    return [
      '<div class="recette-gram">',
      ctx.bandeau,
      this.fiche(),
      this.bloc(ctx.changements, 'changements'),
      this.ingredients(),
      this.materiel(),
      this.preparation(),
      this.notes(),
      this.bloc(ctx.versions, 'versions'),
      this.sourceGram(),
      '</div>'
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}

// --------------------------------------------- coloration du code source

const CLASSES_GRAM = {
  Ingredient: 'g-ing',
  Cookware: 'g-ust',
  Timer: 'g-min',
  Temperature: 'g-temp',
  Reference: 'g-ref',
  IntermediateDecl: 'g-ref',
  Comment: 'g-com',
  ImportDecl: 'g-use'
};

// Colore le source a partir des positions exactes de l'AST de Gram plutot
// qu'avec des expressions regulieres approximatives.
function colorerGram(source) {
  const zones = [];
  const entete = /^---\n[\s\S]*?\n---/.exec(source);
  if (entete) zones.push({ debut: 0, fin: entete[0].length, classe: 'g-meta' });
  for (const titre of source.matchAll(/^##.*$/gm)) {
    zones.push({ debut: titre.index, fin: titre.index + titre[0].length, classe: 'g-sec' });
  }

  const parcourir = (noeud) => {
    if (Array.isArray(noeud)) return noeud.forEach(parcourir);
    if (!noeud || typeof noeud !== 'object') return;
    const classe = CLASSES_GRAM[noeud.type];
    if (classe && noeud.loc) {
      zones.push({ debut: noeud.loc.start, fin: noeud.loc.end, classe });
      return;
    }
    if (noeud.type === 'Step' && noeud.action && noeud.loc) {
      const action = /^\s*\[[^\]\n]*\]/.exec(source.slice(noeud.loc.start));
      if (action) zones.push({ debut: noeud.loc.start, fin: noeud.loc.start + action[0].length, classe: 'g-action' });
    }
    for (const [cle, valeur] of Object.entries(noeud)) {
      if (cle !== 'loc' && cle !== 'meta') parcourir(valeur);
    }
  };
  try {
    parcourir(getAST(source));
  } catch {
    // source illisible : on l'affiche simplement sans couleurs
  }

  zones.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
  let html = '';
  let curseur = 0;
  for (const z of zones) {
    if (z.debut < curseur) continue; // zone incluse dans une precedente
    html += esc(source.slice(curseur, z.debut));
    html += `<span class="${z.classe}">${esc(source.slice(z.debut, z.fin))}</span>`;
    curseur = z.fin;
  }
  return html + esc(source.slice(curseur));
}

// ----------------------------------------------------- front matter Jekyll

function dateDe(meta, fichierRelatif) {
  const brute = meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : meta.date;
  if (brute && /^\d{4}-\d{2}-\d{2}/.test(String(brute))) return String(brute);
  const premiere = git('log', '--follow', '--diff-filter=A', '--format=%ad', '--date=format:%Y-%m-%d %H:%M:%S %z', '--', fichierRelatif)
    .split('\n')
    .filter(Boolean)
    .pop();
  if (premiere) return premiere;
  return new Date().toISOString().slice(0, 10);
}

function descriptionDe(r) {
  if (r.meta.description) return String(r.meta.description);
  const portions = parseInt(r.meta.portions, 10);
  const debut = [portions > 0 ? `${portions} portions` : null, formaterDuree(r.metrics.totalTime)].filter(Boolean).join(', ');
  const noms = r.shopping_list
    .filter((i) => i.type !== 'alternative' && !aModificateur(i, 'hidden', '-'))
    .map((i) => i.name ?? r.registry.ingredients[i.id]?.name ?? i.id);
  const liste = noms.slice(0, 6).join(', ') + (noms.length > 6 ? '…' : '');
  return `${debut ? `${debut.replace(/ /g, ' ')} : ` : ''}${liste}`;
}

// Donnees du front matter Jekyll d'une recette. `surcharge` remplace des champs
// (utilise par les variantes).
function donneesEntete(r, { fichierRelatif, categorieParDefaut, date }) {
  const { meta } = r;
  const entete = {
    title: String(meta.title ?? r.title ?? path.basename(fichierRelatif, '.gram')),
    date: date ?? dateDe(meta, fichierRelatif),
    categories: enListe(meta.category).map(String),
    tags: enListe(meta.tags).map((t) => String(t).toLowerCase()),
    description: descriptionDe(r)
  };
  if (!entete.categories.length) entete.categories = [categorieParDefaut];
  if (meta.image) {
    entete.image = typeof meta.image === 'string' ? { path: meta.image, alt: meta.image_alt ?? entete.title } : meta.image;
  }
  if (meta.pin) entete.pin = true;
  if (Number(git('rev-list', '--count', 'HEAD', '--', fichierRelatif)) > 1) {
    entete.last_modified_at = git('log', '-1', '--format=%ad', '--date=format:%Y-%m-%d %H:%M:%S %z', '--', fichierRelatif);
  }
  entete.gram = fichierRelatif;
  // Le HTML genere ne contient pas de Liquid : on evite qu'un {{ ou {% dans
  // une recette soit interprete par Jekyll.
  entete.render_with_liquid = false;
  return entete;
}

const enteteJekyll = (entete) => `---\n${YAML.stringify(entete, { version: '1.1', lineWidth: 0 })}---\n`;

const categorieParDefaut = (rec) => (rec.relatif.includes('/bases/') ? 'Bases' : 'Recettes');

// ------------------------------------------------------------- variantes

const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());

const titreDe = (rec) => String(rec.r.meta.title ?? rec.r.title ?? path.basename(rec.relatif, '.gram'));

// Nom court d'une variante : « moins de sucre ». Vient de `variante:` ; a defaut,
// de ce qui suit `--` dans le nom du fichier (crepes--moins-de-sucre.gram).
function nomVariante(rec) {
  const declare = texte(rec.r.meta.variante);
  if (declare) return declare;
  const apres = path.basename(rec.relatif, '.gram').split('--').slice(1).join(' ').replace(/-/g, ' ').trim();
  return apres || titreDe(rec);
}

// ------------------------------------------------------------- principal

async function main() {
  const configGram = await lireYaml(path.join(RACINE, '.gram', 'config.yaml'));
  const configJekyll = await lireYaml(path.join(RACINE, '_config.yml'));
  const baseurl = String(configJekyll.baseurl ?? '').replace(/\/$/, '');
  const baseIngredients = await lireYaml(path.join(RACINE, '.gram', 'ingredients.yaml'));
  const db = baseIngredients.ingredients ?? baseIngredients;

  const fichiers = (await readdir(DOSSIER_RECETTES, { recursive: true }))
    .filter((f) => f.endsWith('.gram'))
    .map((f) => path.join(DOSSIER_RECETTES, f))
    .sort();

  // Premier passage : compiler toutes les recettes.
  let recettes = [];
  const nonPubliees = new Set();
  let erreurs = 0;
  for (const fichier of fichiers) {
    const relatif = path.relative(RACINE, fichier).split(path.sep).join('/');
    let resultat;
    try {
      resultat = await runPipeline(fichier, { db, lang: configGram.language ?? 'fr', paths: configGram.paths });
    } catch (err) {
      console.error(`✗ ${relatif}\n    ${err.message}`);
      erreurs++;
      continue;
    }
    const r = resultat.analyzed ? resultat.analyzed.result : resultat.compiled;
    // Le lecteur d'en-tete de Gram est minimal (il garde par exemple les ''
    // des chaines YAML) : on relit l'en-tete avec un vrai parseur YAML.
    try {
      r.meta = { ...r.meta, ...lireEntete(resultat.content) };
    } catch (err) {
      console.error(`✗ ${relatif}\n    ${err.message}`);
      erreurs++;
      continue;
    }
    const problemes = r.warnings.filter((w) => !CODES_BASE_INGREDIENTS.has(w.code));
    const bloquants = problemes.filter((w) => warningSeverityOf(w.code) === 'error');
    erreurs += bloquants.length;
    console.log(`${bloquants.length ? '✗' : '✓'} ${relatif}`);
    for (const w of problemes) {
      const ligne = w.loc ? `ligne ${resultat.content.slice(0, w.loc.start).split('\n').length} : ` : '';
      console.log(`    ${GRAVITES[warningSeverityOf(w.code)] ?? 'attention'} ${w.code} — ${ligne}${w.message}`);
    }
    const rec = {
      fichier,
      relatif,
      r,
      contenu: resultat.content,
      slug: slug(path.basename(fichier, '.gram')),
      parent: r.meta.variante_de ? slug(String(r.meta.variante_de)) : null
    };
    if (r.meta.publier === false || r.meta.publier === 'false') {
      nonPubliees.add(rec.slug);
      continue;
    }
    recettes.push(rec);
  }

  const parSlug = new Map();
  for (const rec of recettes) {
    if (parSlug.has(rec.slug)) {
      console.error(`✗ ${rec.relatif} et ${parSlug.get(rec.slug).relatif} donnent la même adresse (${rec.slug}) : renommez l'un des deux.`);
      erreurs++;
    }
    parSlug.set(rec.slug, rec);
  }

  // Les variantes : chacune doit se rattacher a une recette d'origine.
  const ignorees = new Set();
  for (const rec of recettes.filter((x) => x.parent)) {
    const statut = normaliserStatut(rec.r.meta.statut);
    if (!statut) {
      console.error(`✗ ${rec.relatif} : le statut « ${rec.r.meta.statut} » n'existe pas (essai, retenue ou ecartee).`);
      erreurs++;
    }
    rec.statut = statut ?? 'essai';
    const origine = parSlug.get(rec.parent);
    if (rec.parent === rec.slug) {
      console.error(`✗ ${rec.relatif} : une recette ne peut pas être sa propre variante (variante_de: ${rec.r.meta.variante_de}).`);
      erreurs++;
    } else if (!origine && nonPubliees.has(rec.parent)) {
      console.log(`  ↳ ${rec.relatif} : variante d'une recette non publiée (publier: false), ignorée.`);
      ignorees.add(rec);
    } else if (!origine) {
      console.error(
        `✗ ${rec.relatif} : variante_de « ${rec.r.meta.variante_de} » ne correspond à aucune recette. ` +
          `Indiquez le nom du fichier sans .gram, par exemple « crepes ».`
      );
      erreurs++;
    } else if (origine.parent) {
      console.error(
        `✗ ${rec.relatif} : « ${rec.r.meta.variante_de} » est elle-même une variante. ` +
          `Rattachez celle-ci à la recette d'origine : variante_de: ${origine.parent}.`
      );
      erreurs++;
    }
  }
  recettes = recettes.filter((rec) => !ignorees.has(rec));

  if (erreurs) {
    console.error(`\n${erreurs} erreur(s) : corrigez les recettes ci-dessus.`);
    process.exit(1);
  }
  const nbVariantes = recettes.filter((rec) => rec.parent).length;
  const resume = `${recettes.length - nbVariantes} recette(s)${nbVariantes ? ` et ${nbVariantes} variante(s)` : ''}`;
  if (VERIFIER_SEULEMENT) {
    console.log(`\n${resume} valide(s).`);
    return;
  }

  // Adresse de chaque page : /posts/<recette>/ ou /variantes/<variante>/.
  const urlParFichier = new Map(
    recettes.map((rec) => [rec.fichier, `${baseurl}/${rec.parent ? 'variantes' : 'posts'}/${rec.slug}/`])
  );
  for (const rec of recettes) rec.date = dateDe(rec.r.meta, rec.relatif);

  // « Version » : ce que le module variantes.mjs sait comparer et afficher.
  const versionDe = (rec, origine) => ({
    slug: rec.slug,
    relatif: rec.relatif,
    r: rec.r,
    url: urlParFichier.get(rec.fichier),
    statut: rec.statut ?? 'essai',
    objectif: texte(rec.r.meta.objectif),
    verdict: texte(rec.r.meta.verdict),
    nom: origine ? nomVariante(rec) : 'Originale',
    titre: origine && (!rec.r.meta.title || titreDe(rec) === titreDe(origine)) ? `${titreDe(origine)} — ${nomVariante(rec)}` : titreDe(rec)
  });

  const variantesDe = new Map();
  for (const rec of recettes.filter((x) => x.parent)) {
    const liste = variantesDe.get(rec.parent) ?? [];
    liste.push(rec);
    variantesDe.set(rec.parent, liste);
  }
  for (const liste of variantesDe.values()) {
    liste.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.relatif.localeCompare(b.relatif));
  }

  // Second passage : ecrire les pages.
  await rm(DOSSIER_POSTS, { recursive: true, force: true });
  await rm(DOSSIER_VARIANTES, { recursive: true, force: true });
  await mkdir(DOSSIER_POSTS, { recursive: true });
  if (nbVariantes) await mkdir(DOSSIER_VARIANTES, { recursive: true });

  for (const rec of recettes) {
    const optionsEntete = { fichierRelatif: rec.relatif, categorieParDefaut: categorieParDefaut(rec), date: rec.date };
    const contexte = { chemin: rec.relatif, contenu: rec.contenu, urlDe: (uri) => urlParFichier.get(uri) };
    const entete = donneesEntete(rec.r, optionsEntete);

    if (!rec.parent) {
      // Recette d'origine : elle annonce ses variantes.
      const variantes = (variantesDe.get(rec.slug) ?? []).map((v) => versionDe(v, rec));
      if (variantes.length) {
        const origine = versionDe(rec, null);
        contexte.bandeau = bandeauRetenue(variantes);
        contexte.versions = (idTitre) => blocVersions({ racine: origine, variantes, courant: null, idTitre });
      }
      const corps = new Rendu(rec.r, contexte).page();
      await writeFile(path.join(DOSSIER_POSTS, `${rec.date.slice(0, 10)}-${rec.slug}.html`), `${enteteJekyll(entete)}\n${corps}\n`);
      continue;
    }

    // Variante : elle montre ce qu'elle change et se compare aux autres.
    const racine = parSlug.get(rec.parent);
    const origine = versionDe(racine, null);
    const variantes = variantesDe.get(racine.slug).map((v) => versionDe(v, racine));
    const moi = variantes.find((v) => v.slug === rec.slug);
    const diff = differences(origine, moi);
    contexte.bandeau = bandeauVariante(moi, origine);
    contexte.changements = (idTitre) => blocChangements(diff, origine, idTitre, rec.relatif);
    contexte.versions = (idTitre) => blocVersions({ racine: origine, variantes, courant: moi, idTitre });
    contexte.marques = diff.marques;

    // Meme categories et memes etiquettes que la recette d'origine : la page
    // n'est pas dans les listes du site, mais ses liens doivent mener quelque part.
    const entetesOrigine = donneesEntete(racine.r, {
      fichierRelatif: racine.relatif,
      categorieParDefaut: categorieParDefaut(racine),
      date: racine.date
    });
    Object.assign(entete, {
      title: moi.titre,
      categories: entetesOrigine.categories,
      tags: entetesOrigine.tags,
      description: rec.r.meta.description ? String(rec.r.meta.description) : moi.objectif || descriptionVariante(origine, diff),
      variante_de: racine.slug
    });
    delete entete.pin;

    const corps = new Rendu(rec.r, contexte).page();
    await writeFile(path.join(DOSSIER_VARIANTES, `${rec.slug}.html`), `${enteteJekyll(entete)}\n${corps}\n`);
  }
  console.log(`\n${resume} écrite(s) dans _posts/gram/${nbVariantes ? ' et _variantes/' : ''}.`);
}

await main();
