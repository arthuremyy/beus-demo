/* Recadrer une photo de profil avant l'envoi.

   Plein écran modal : la photo sous un voile, percé d'un rond — ce qui est
   dans le rond est ce qui sera gardé. Un doigt la déplace, deux doigts (ou la
   molette) la zooment. La photo couvre toujours le rond : on ne
   peut pas laisser de vide dedans.

   Sortie : un carré JPEG de 640 px (le rond est le cercle inscrit), ou null si
   on annule. Le serveur ré-encode de toute façon (et purge l'EXIF). */
import { IC } from './icones.js';

const SORTIE = 640;        // côté du carré envoyé
const ZOOM_MAX = 4;        // au-delà du cadrage minimal
const COTE_TRAVAIL = 2048; // la photo est d'abord réduite : une photo d'iPhone
                           // de 48 Mpx décodée entière pèse ~200 Mo en mémoire

async function decode(fichier) {
    const brute = await createImageBitmap(fichier);
    const k = Math.min(1, COTE_TRAVAIL / Math.max(brute.width, brute.height));
    if (k === 1) return brute;
    const c = document.createElement('canvas');
    c.width = Math.round(brute.width * k);
    c.height = Math.round(brute.height * k);
    c.getContext('2d').drawImage(brute, 0, 0, c.width, c.height);
    brute.close?.();
    return c;
}

export async function recadre(fichier) {
    let source;
    try { source = await decode(fichier); } catch { return fichier; }   // illisible ici : le serveur tranchera
    const W = source.width, H = source.height;

    return new Promise((fini) => {
        const v = document.createElement('div');
        v.className = 'recadrage';
        v.setAttribute('role', 'dialog');
        v.setAttribute('aria-modal', 'true');
        v.setAttribute('aria-label', 'Recadrer la photo de profil');
        v.innerHTML = `
            <div class="barre">
                <button class="ico-btn" data-annule aria-label="Annuler">${IC.croix}</button>
                <h1 class="titre">Recadrer</h1>
                <span class="barre-vide"></span>
            </div>
            <div class="rc-zone"><div class="rc-scene"><canvas></canvas><div class="rc-rond" aria-hidden="true"></div></div></div>
            <div class="rc-pied">
                <button class="btn btn-plein" data-valide>Valider</button>
            </div>`;
        document.body.appendChild(v);

        const scene = v.querySelector('.rc-scene');
        const cv = v.querySelector('canvas');
        const ctx = cv.getContext('2d');
        let S = 0;               // côté de la scène, en px CSS
        let base = 1;            // échelle qui couvre juste le rond
        let z = 1;               // zoom relatif (1 … ZOOM_MAX)
        let x = 0, y = 0;        // position du coin haut-gauche de la photo dans la scène

        const echelle = () => base * z;
        const borne = () => {
            const k = echelle();
            x = Math.min(0, Math.max(S - W * k, x));
            y = Math.min(0, Math.max(S - H * k, y));
        };
        const dessine = () => {
            const dpr = window.devicePixelRatio || 1;
            if (cv.width !== Math.round(S * dpr)) {
                cv.width = cv.height = Math.round(S * dpr);
                cv.style.width = cv.style.height = `${S}px`;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, S, S);
            const k = echelle();
            ctx.drawImage(source, x, y, W * k, H * k);
        };
        /* Zoom autour d'un point de la scène (le centre par défaut) : le point
           sous les doigts reste sous les doigts. */
        const zoome = (nz, cx = S / 2, cy = S / 2) => {
            nz = Math.min(ZOOM_MAX, Math.max(1, nz));
            const k0 = echelle();
            const px = (cx - x) / k0, py = (cy - y) / k0;
            z = nz;
            const k1 = echelle();
            x = cx - px * k1;
            y = cy - py * k1;
            borne();
            dessine();
        };
        const mesure = () => {
            S = scene.clientWidth;
            base = Math.max(S / W, S / H);
            borne();
            dessine();
        };
        S = scene.clientWidth;
        base = Math.max(S / W, S / H);
        x = (S - W * base) / 2;
        y = (S - H * base) / 2;
        dessine();
        window.addEventListener('resize', mesure);

        // Gestes : un pointeur déplace, deux pincent.
        const pointeurs = new Map();
        let pince = null;   // { d, z, cx, cy }
        const local = (e) => {
            const r = scene.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        scene.addEventListener('pointerdown', (e) => {
            scene.setPointerCapture(e.pointerId);
            pointeurs.set(e.pointerId, local(e));
            if (pointeurs.size === 2) {
                const [a, b] = [...pointeurs.values()];
                pince = { d: Math.hypot(a.x - b.x, a.y - b.y), z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
            }
        });
        scene.addEventListener('pointermove', (e) => {
            if (!pointeurs.has(e.pointerId)) return;
            const avant = pointeurs.get(e.pointerId);
            const apres = local(e);
            pointeurs.set(e.pointerId, apres);
            if (pointeurs.size === 1) {
                x += apres.x - avant.x;
                y += apres.y - avant.y;
                borne();
                dessine();
            } else if (pince && pointeurs.size === 2) {
                const [a, b] = [...pointeurs.values()];
                zoome(pince.z * (Math.hypot(a.x - b.x, a.y - b.y) / (pince.d || 1)), pince.cx, pince.cy);
            }
        });
        const leve = (e) => {
            pointeurs.delete(e.pointerId);
            if (pointeurs.size < 2) pince = null;
        };
        scene.addEventListener('pointerup', leve);
        scene.addEventListener('pointercancel', leve);
        scene.addEventListener('wheel', (e) => {
            e.preventDefault();
            const p = local(e);
            zoome(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y);
        }, { passive: false });

        const ferme = (resultat) => {
            window.removeEventListener('resize', mesure);
            v.remove();
            source.close?.();
            fini(resultat);
        };
        v.querySelector('[data-annule]').addEventListener('click', () => ferme(null));
        v.addEventListener('keydown', (e) => { if (e.key === 'Escape') ferme(null); });
        v.querySelector('[data-valide]').addEventListener('click', () => {
            const k = echelle();
            const out = document.createElement('canvas');
            out.width = out.height = SORTIE;
            out.getContext('2d').drawImage(source, -x / k, -y / k, S / k, S / k, 0, 0, SORTIE, SORTIE);
            out.toBlob((b) => ferme(b || fichier), 'image/jpeg', 0.9);
        });
        v.querySelector('[data-valide]').focus({ preventScroll: true });
    });
}
