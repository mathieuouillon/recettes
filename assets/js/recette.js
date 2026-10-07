// recette.js -- formatage des quantites et ajustement des portions.
//
// Ce fichier sert deux fois :
//   - dans le navigateur (module charge par _includes/metadata-hook.html),
//     il branche les boutons -/+ des portions sur chaque page de recette ;
//   - dans Node (tools/gram-jekyll.mjs), il formate les quantites au moment
//     de generer les pages, pour que l'affichage initial et l'affichage
//     recalcule utilisent exactement les memes regles.

// Unites ou l'on garde des decimales ; ailleurs (pieces, cuilleres,
// pincees...) on prefere les fractions usuelles.
const UNITES_DECIMALES = new Set(['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l']);

const FRACTIONS = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾']
];

// Precision utile en cuisine : 563 g, 5,6 g, 0,75 l.
function enDecimal(v) {
  let arrondi;
  if (v >= 10) arrondi = Math.round(v);
  else if (v >= 1) arrondi = Math.round(v * 10) / 10;
  else arrondi = Math.round(v * 100) / 100;
  return arrondi.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

export function formaterNombre(v, unite) {
  if (!Number.isFinite(v)) return '';
  const decimales = unite && UNITES_DECIMALES.has(unite.toLowerCase());
  if (!decimales) {
    const entier = Math.floor(v + 1e-9);
    const reste = v - entier;
    if (reste > 0.96) return String(entier + 1);
    if (reste < 0.04 && entier > 0) return String(entier);
    for (const [fraction, glyphe] of FRACTIONS) {
      if (Math.abs(reste - fraction) < 0.04) {
        return entier ? `${entier} ${glyphe}` : glyphe;
      }
    }
  }
  return enDecimal(v);
}

// "250 g", "2 à 4", "1 ½ c.à.s" -- espace insecable avant l'unite.
export function formaterQuantite(min, max, unite) {
  let texte = formaterNombre(min, unite);
  if (max !== undefined && max !== null && max !== min) {
    texte += ` à ${formaterNombre(max, unite)}`;
  }
  return unite ? `${texte} ${unite}` : texte;
}

function nombre(attribut) {
  return attribut === undefined ? undefined : Number(attribut);
}

function appliquerFacteur(recette, facteur) {
  for (const el of recette.querySelectorAll('.qte[data-v], .qte[data-min]')) {
    if ('fixe' in el.dataset) continue;
    const unite = el.dataset.u || '';
    // Pieces a acheter, ustensiles : arrondi au-dessus des qu'on s'ecarte
    // de la recette d'origine.
    const arrondir = 'entier' in el.dataset && facteur !== 1
      ? (v) => Math.max(1, Math.ceil(v - 1e-9))
      : (v) => v;
    if (el.dataset.v !== undefined) {
      el.textContent = formaterQuantite(arrondir(nombre(el.dataset.v) * facteur), null, unite);
    } else {
      el.textContent = formaterQuantite(
        arrondir(nombre(el.dataset.min) * facteur),
        arrondir(nombre(el.dataset.max) * facteur),
        unite
      );
    }
  }
}

function brancherRecette(recette) {
  const reglage = recette.querySelector('.reglage-portions');
  if (!reglage) return;
  const base = Number(reglage.dataset.base) || 1;
  const pas = Number(reglage.dataset.pas) || 1;
  const sortie = reglage.querySelector('output');
  const prefixe = reglage.dataset.prefixe || '';
  let valeur = base;

  const afficher = () => {
    sortie.textContent = prefixe + formaterNombre(valeur, null);
    appliquerFacteur(recette, valeur / base);
    reglage.querySelector('.portions-moins').disabled = valeur <= pas;
    reglage.querySelector('.portions-reset').hidden = valeur === base;
  };

  reglage.addEventListener('click', (e) => {
    const bouton = e.target.closest('button');
    if (!bouton) return;
    if (bouton.classList.contains('portions-plus')) valeur += pas;
    else if (bouton.classList.contains('portions-moins')) valeur = Math.max(pas, valeur - pas);
    else if (bouton.classList.contains('portions-reset')) valeur = base;
    afficher();
  });

  afficher();
}

// Le bouton "telecharger" enregistre le texte du bloc de code voisin : c'est
// exactement le fichier .gram d'origine (les <span> de coloration en moins).
function brancherTelechargement(bouton) {
  bouton.addEventListener('click', () => {
    const code = bouton.closest('.source-gram').querySelector('pre code');
    const fichier = new Blob([code.textContent], { type: 'text/plain;charset=utf-8' });
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(fichier);
    lien.download = bouton.dataset.nom;
    lien.click();
    URL.revokeObjectURL(lien.href);
  });
}

if (typeof document !== 'undefined') {
  const demarrer = () => {
    document.querySelectorAll('.recette-gram').forEach(brancherRecette);
    document.querySelectorAll('.telecharger-gram').forEach(brancherTelechargement);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
}
