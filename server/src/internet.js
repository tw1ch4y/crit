// DA LI IGRAONICA IMA INTERNET
//
// Traku na dnu launchera gleda igrač: ako mu pregledač ne radi, hoće da vidi je
// li do njega ili do interneta. Do sada je svaki launcher to proveravao sam,
// tako što je svakih 30 sekundi učitavao `google.com/favicon.ico`.
//
// Tri stvari nisu valjale:
//
//   1. TRINAEST MAŠINA, SVAKA SVOJIH DVA ZAHTEVA U MINUTI - oko 37.000 poziva
//      dnevno ka Google-u, sa svakog računara u igraonici, ceo dan.
//   2. INDIKATOR JE LAGAO kad je baš Google nedostupan (filter na ruteru,
//      odvojena gostinska mreža, ispad kod jednog provajdera): internet radi, a
//      na svih trinaest ekrana piše da ga nema.
//   3. Provera je išla sa računara na kom je igrač prijavljen, a odgovor na
//      pitanje "ima li kuća internet" je isti za sve njih.
//
// Sada server proverava JEDNOM, i to javlja svima. Server je na istom ruteru
// kao i mašine, pa je odgovor isti; a kad server ne radi, launcher to već vidi
// po svojoj traci ("Server: nema veze") i internet prikazuje kao nepoznat
// umesto da izmišlja.
//
// Adresa nije Google nego mesto napravljeno baš za ovu proveru: vraća kratak,
// tačno određen tekst, pa se prepoznaje i kad neka usputna oprema podmetne svoju
// stranicu (gostinske mreže to rade). Ako prva ne odgovori, ide druga - jedan
// nedostupan servis ne sme da znači "nema interneta".
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

// Javlja se SAMO kad se stanje promeni. Poruka svakih minut, uvek ista, bila bi
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

// Poslednje što se zna. `null` znači "još nije provereno" i NIJE isto što i
// "nema interneta" - launcher tada piše da ne zna, umesto da izmisli.
export const stanjeInterneta = () => stanje;
