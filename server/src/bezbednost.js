import fs from "node:fs";

// ---- BEZBEDNOSNI DNEVNIK ----
//
// Sve sto lici na pokusaj zloupotrebe (neispravan token, poruka koja ne
// odgovara protokolu, zatrpavanje servera, pokusaj duple naplate ili drugog
// vrtenja tocka) zapisuje se OVDE, na jednom mestu i u istom obliku.
//
// Zapis ide na tri mesta, svako sa svojom svrhom:
//
//   1. data/bezbednost.jsonl  - jedan JSON po redu, za kasniju istragu. Ne
//      sece se sa logovima panela (odrzavanje brise stare logove), nego ima
//      svoje okretanje po velicini.
//   2. konzola servera        - isti JSON, da se vidi i dok se gleda uzivo.
//   3. Logovi u panelu        - kategorija "bezbednost", ljudskim recima. Samo
//      ono sto je za oko vlasnika (nivo upozorenje i kriticno). Obican "info"
//      (npr. token sesije koja se u medjuvremenu regularno zavrsila) ne treba
//      da mu zatrpava ekran.
//
// U zapis NIKAD ne ulaze lozinke, PIN-ovi ni tokeni - polja sa tim imenima se
// brisu pre upisa, ma koliko duboko stajala.
//
// ISTI DOGADJAJ SE NE PISE HILJADU PUTA. Racunar koji salje smece u petlji bi
// inace napunio disk. Isti par (vrsta, izvor) se upisuje najvise jednom u
// PAUZA_ISTOG; sve sto je preskoceno broji se i prijavi uz sledeci upis kao
// "ponovljeno".

export const NIVO = { info: "info", upozorenje: "upozorenje", kriticno: "kriticno" };
const RANG_NIVOA = { info: 1, upozorenje: 2, kriticno: 3 };

export const PAUZA_ISTOG = 60_000;
let najveciFajl = 5 * 1024 * 1024; // posle ovoga ide u .1 i krece se ispocetka
const PAMTI_U_MEMORIJI = 300;
const NAJVISE_KLJUCEVA = 5000;

const TAJNA_POLJA = /^(password|oldpassword|newpassword|lozinka|pin|token|sesija|tajna|secret|authorization)$/i;

// Putanju postavlja index.js (data/bezbednost.jsonl). Dok nije postavljena,
// zapis ide samo u konzolu i memoriju - tako se modul moze proveravati sam,
// bez dizanja servera i bez diranja baze.
let fajl = null;
let velicinaFajla = null;
let uLogove = null; // postavlja index.js: (zapis za tabelu logs) => void
let uKonzolu = (red) => console.warn("[bezbednost] " + red);
const skoro = new Map(); // kljuc -> { kad, preskoceno }
const poslednji = []; // poslednji zapisi, najnoviji na kraju

// Veza ka tabeli logova se ubacuje spolja: service.js uvozi ovaj modul, pa bi
// uvoz u suprotnom smeru napravio krug.
export function povezi({ logEvent, konzola, putanja, najveci } = {}) {
  if (logEvent !== undefined) uLogove = logEvent;
  if (konzola !== undefined) uKonzolu = konzola;
  if (putanja !== undefined) { fajl = putanja; velicinaFajla = null; }
  if (najveci !== undefined) najveciFajl = najveci;
}

// Brise tajne i skracuje tekst, da zapis bude bezbedan i ogranicene velicine.
export function ocisti(v, dubina = 0) {
  if (v == null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "..." : v;
  if (dubina > 3) return "[...]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => ocisti(x, dubina + 1));
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 30)) {
      out[k] = TAJNA_POLJA.test(k) ? "[skriveno]" : ocisti(x, dubina + 1);
    }
    return out;
  }
  return String(v).slice(0, 200);
}

function upisiUFajl(red) {
  if (!fajl) return;
  try {
    if (velicinaFajla == null) {
      try { velicinaFajla = fs.statSync(fajl).size; } catch { velicinaFajla = 0; }
    }
    const bajtova = Buffer.byteLength(red) + 1;
    if (velicinaFajla + bajtova > najveciFajl) {
      try { fs.renameSync(fajl, fajl + ".1"); } catch {}
      velicinaFajla = 0;
    }
    fs.appendFileSync(fajl, red + "\n");
    velicinaFajla += bajtova;
  } catch {
    // Pun disk ili zakljucan fajl ne sme da obori server - zapis ostaje bar
    // u konzoli i u memoriji.
  }
}

function ocistiStareKljuceve(sada) {
  if (skoro.size < NAJVISE_KLJUCEVA) return;
  for (const [k, v] of skoro) if (sada - v.kad > PAUZA_ISTOG) skoro.delete(k);
}

// Glavni ulaz.
//
//   vrsta     kratka oznaka dogadjaja (npr. "token_racunara_neispravan")
//   nivo      info | upozorenje | kriticno
//   opis      jedna recenica za coveka
//   ip, racunar, racunarId, igrac   ko i odakle
//   podaci    sve ostalo sto pomaze istrazi (cisti se od tajni)
//   kljuc     sta se smatra "istim dogadjajem" za prigusivanje; podrazumevano
//             vrsta + racunar/ip
//
// Vraca zapis ako je upisan, null ako je prigusen.
export function zabelezi({ vrsta, nivo = NIVO.upozorenje, opis = "", ip = null, racunar = null, racunarId = null,
  igrac = null, podaci = null, kljuc = null, sada = Date.now() } = {}) {
  if (!vrsta) return null;
  if (!RANG_NIVOA[nivo]) nivo = NIVO.upozorenje;
  const k = kljuc || `${vrsta}|${racunarId ?? racunar ?? ip ?? "-"}`;
  const pre = skoro.get(k);
  if (pre && sada - pre.kad < PAUZA_ISTOG) {
    pre.preskoceno++;
    return null;
  }
  ocistiStareKljuceve(sada);
  const ponovljeno = pre ? pre.preskoceno : 0;
  skoro.set(k, { kad: sada, preskoceno: 0 });

  const zapis = {
    ts: new Date(sada).toISOString(),
    nivo,
    vrsta,
    opis: String(opis).slice(0, 300),
    ip: ip || null,
    racunar: racunar || null,
    racunarId: racunarId ?? null,
    igrac: igrac || null,
    podaci: podaci ? ocisti(podaci) : null,
    ponovljeno,
  };
  const red = JSON.stringify(zapis);
  upisiUFajl(red);
  try { uKonzolu(red); } catch {}
  poslednji.push(zapis);
  if (poslednji.length > PAMTI_U_MEMORIJI) poslednji.shift();

  if (uLogove && RANG_NIVOA[nivo] >= RANG_NIVOA.upozorenje) {
    try {
      uLogove({
        category: "bezbednost",
        action: vrsta,
        actor: igrac || ip || "sistem",
        target: racunar || ip || null,
        detail: zapis.opis + (ponovljeno ? ` (još ${ponovljeno} puta u poslednjem minutu)` : ""),
      });
    } catch {}
  }
  return zapis;
}

// Poslednji zapisi iz memorije, najnoviji prvi. Za panel i za testove.
export function poslednjiZapisi({ limit = 100, vrsta = null, nivo = null } = {}) {
  const n = Math.max(1, Math.min(PAMTI_U_MEMORIJI, Number(limit) || 100));
  const out = [];
  for (let i = poslednji.length - 1; i >= 0 && out.length < n; i--) {
    const z = poslednji[i];
    if (vrsta && z.vrsta !== vrsta) continue;
    if (nivo && z.nivo !== nivo) continue;
    out.push(z);
  }
  return out;
}

// Samo za testove: pocni od nule.
export function zaboravi() {
  skoro.clear();
  poslednji.length = 0;
}
