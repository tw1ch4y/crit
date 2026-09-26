// Da li igraonica ima internet.
//
// Proverava server, jednom u minuti, i javlja svim launcherima samo kad se
// stanje promeni. Adrese su napravljene za ovu proveru i vraćaju tačno
// određen tekst, pa se prepoznaje i gostinska mreža koja podmeće svoju
// stranicu. Ako prva adresa ne odgovori, proba se druga.
const MESTA = [
  { url: "https://www.msftconnecttest.com/connecttest.txt", sadrzi: "Microsoft Connect Test" },
  { url: "https://cloudflare.com/cdn-cgi/trace", sadrzi: "fl=" },
];
const RAZMAK_MS = 60_000;
const ROK_MS = 5000;

let stanje = null;      // null = jos se nije proverilo
let tajmer = null;
let javi = null;

async function jedno({ url, sadrzi }) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ROK_MS), redirect: "manual",
      headers: { "cache-control": "no-cache" } });
    if (!r.ok) return false;
    return (await r.text()).includes(sadrzi);
  } catch {
    return false;
  }
}

export async function proveri() {
  for (const mesto of MESTA) {
    if (await jedno(mesto)) return true;
  }
  return false;
}

// Javlja se samo kad se stanje promeni. Poruka svakih minut, uvek ista, bila bi
// saobraćaj bez sadržaja - a launcher ionako pamti poslednje što je čuo.
async function krug() {
  const sad = await proveri();
  if (sad !== stanje) {
    stanje = sad;
    javi?.(sad);
  }
}

export function pokreni(naPromenu) {
  javi = naPromenu;
  clearInterval(tajmer);
  krug();
  tajmer = setInterval(krug, RAZMAK_MS);
  // Provera ne sme da drži proces u životu: bez ovoga se server ne bi ugasio
  // sam od sebe, pa bi svaki test ostavljao node koji visi.
  tajmer.unref?.();
}

export function stani() {
  clearInterval(tajmer);
  tajmer = null;
}

// Poslednje što se zna. `null` znači "još nije provereno" i nije isto što i
// "nema interneta" - launcher tada piše da ne zna, umesto da izmisli.
export const stanjeInterneta = () => stanje;
