// minuteur.js -- minuteur de cuisine dans la barre laterale.
//
// Le minuteur survit au changement de page : son etat (heure de fin, duree,
// pause) est dans localStorage, et le compte a rebours se calcule a partir de
// l'heure de fin, donc il reste juste meme quand l'onglet est en arriere-plan.
// Cliquer sur le minuteur d'une etape ([data-secondes]) le lance.

const CLE = 'minuteur-recettes';
const SONNERIE_MAX_MS = 90_000;

const lire = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE)) ?? {};
  } catch {
    return {};
  }
};

const ecrire = (etat) => {
  try {
    localStorage.setItem(CLE, JSON.stringify(etat));
  } catch {
    // stockage indisponible : le minuteur marche encore, sans survivre a la page
    memoire = etat;
  }
};

let memoire = null;
const etatCourant = () => memoire ?? lire();

// État : { duree (s), fin (ms, si en marche), restant (s, si arrete), fini (bool) }
const restantSecondes = (e) => (e.fin ? Math.max(0, Math.ceil((e.fin - Date.now()) / 1000)) : (e.restant ?? 0));

const formater = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const deux = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${deux(m)}:${deux(sec)}` : `${deux(m)}:${deux(sec)}`;
};

// ------------------------------------------------------------- sonnerie

let audio = null;
let sonnerie = null;

function bips() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
    for (let i = 0; i < 3; i++) {
      const t0 = audio.currentTime + i * 0.28;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    }
  } catch {
    // pas de son possible : l'affichage suffit
  }
}

function demarrerSonnerie() {
  if (sonnerie) return;
  bips();
  const debut = Date.now();
  sonnerie = setInterval(() => {
    if (Date.now() - debut > SONNERIE_MAX_MS) arreterSonnerie();
    else bips();
  }, 1600);
}

function arreterSonnerie() {
  clearInterval(sonnerie);
  sonnerie = null;
}

// ------------------------------------------------------------ interface

const titreOrigine = document.title;
let racine;
let puce;

function construire() {
  const nav = document.querySelector('#sidebar nav');
  if (!nav) return false;

  racine = document.createElement('section');
  racine.className = 'minuteur-lateral';
  racine.setAttribute('aria-label', 'Minuteur');
  racine.innerHTML = `
    <p class="minuteur-titre">Minuteur</p>
    <p class="minuteur-temps" role="timer">00:00</p>
    <div class="minuteur-ajouts">
      <button type="button" data-ajout="-60" aria-label="Retirer une minute">−1</button>
      <button type="button" data-ajout="60" aria-label="Ajouter une minute">+1</button>
      <button type="button" data-ajout="300" aria-label="Ajouter cinq minutes">+5</button>
      <button type="button" data-ajout="600" aria-label="Ajouter dix minutes">+10</button>
      <span>min</span>
    </div>
    <div class="minuteur-actions">
      <button type="button" class="minuteur-principal">Démarrer</button>
      <button type="button" class="minuteur-raz">Remettre à zéro</button>
    </div>`;
  nav.after(racine);

  // Sur petit ecran la barre laterale est cachee : une pastille rappelle le temps restant.
  puce = document.createElement('button');
  puce.type = 'button';
  puce.className = 'minuteur-puce';
  puce.hidden = true;
  puce.setAttribute('aria-label', 'Minuteur : ouvrir la barre laterale');
  puce.addEventListener('click', () => document.getElementById('sidebar-trigger')?.click());
  document.body.append(puce);

  racine.addEventListener('click', (e) => {
    const bouton = e.target.closest('button');
    if (!bouton) return;
    if (bouton.dataset.ajout) ajouter(Number(bouton.dataset.ajout));
    else if (bouton.classList.contains('minuteur-principal')) basculer();
    else if (bouton.classList.contains('minuteur-raz')) remettreAZero();
  });
  return true;
}

function afficher() {
  const e = etatCourant();
  const reste = restantSecondes(e);
  const enMarche = Boolean(e.fin);
  const fini = Boolean(e.fini);

  racine.classList.toggle('en-marche', enMarche);
  racine.classList.toggle('fini', fini);
  racine.querySelector('.minuteur-temps').textContent = fini ? 'Terminé' : formater(reste);

  const principal = racine.querySelector('.minuteur-principal');
  principal.textContent = fini ? 'Arrêter' : enMarche ? 'Pause' : e.duree && reste < e.duree && reste > 0 ? 'Reprendre' : 'Démarrer';

  const actif = enMarche || fini || (e.duree > 0 && reste > 0);
  // La pastille ne sert que si la barre laterale est cachee (petit ecran, menu ferme).
  const barreVisible = document.getElementById('sidebar')?.getBoundingClientRect().right > 4;
  puce.hidden = !actif || barreVisible;
  puce.classList.toggle('fini', fini);
  puce.textContent = fini ? 'Terminé' : formater(reste);

  if (fini) document.title = `⏰ Minuteur terminé · ${titreOrigine}`;
  else if (enMarche) document.title = `⏱ ${formater(reste)} · ${titreOrigine}`;
  else document.title = titreOrigine;
}

function tic() {
  const e = etatCourant();
  if (e.fin && Date.now() >= e.fin) {
    ecrire({ duree: e.duree, restant: 0, fin: null, fini: true });
    demarrerSonnerie();
  }
  afficher();
}

// ------------------------------------------------------------- actions

function demarrerAvec(secondes) {
  arreterSonnerie();
  ecrire({ duree: secondes, fin: Date.now() + secondes * 1000, restant: null, fini: false });
  afficher();
}

function basculer() {
  const e = etatCourant();
  if (e.fini) {
    arreterSonnerie();
    ecrire({ duree: e.duree, restant: e.duree ?? 0, fin: null, fini: false });
  } else if (e.fin) {
    ecrire({ ...e, restant: restantSecondes(e), fin: null });
  } else if ((e.restant ?? 0) > 0) {
    ecrire({ ...e, fin: Date.now() + e.restant * 1000, restant: null });
  }
  afficher();
}

function ajouter(secondes) {
  const e = etatCourant();
  if (e.fini) return;
  if (e.fin) {
    const fin = e.fin + secondes * 1000;
    if (fin <= Date.now()) return;
    ecrire({ ...e, fin, duree: Math.max(e.duree ?? 0, restantSecondes({ fin }) )});
  } else {
    const restant = Math.max(0, (e.restant ?? 0) + secondes);
    ecrire({ duree: Math.max(e.duree ?? 0, restant), restant, fin: null, fini: false });
  }
  afficher();
}

function remettreAZero() {
  arreterSonnerie();
  ecrire({ duree: 0, restant: 0, fin: null, fini: false });
  afficher();
}

// Clic (ou Entree / Espace) sur le minuteur d'une etape : on le lance dans la barre laterale.
function lancerDepuisEtape(el) {
  const secondes = Number(el.dataset.secondes);
  if (secondes > 0) demarrerAvec(secondes);
}

function demarrer() {
  if (!construire()) return;
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-secondes]');
    if (el) lancerDepuisEtape(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest?.('[data-secondes]');
    if (!el) return;
    e.preventDefault();
    lancerDepuisEtape(el);
  });
  // Autre onglet : on suit son etat.
  window.addEventListener('storage', (e) => {
    if (e.key === CLE) afficher();
  });
  tic();
  setInterval(tic, 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
else demarrer();
