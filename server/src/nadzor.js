// ---------- NADZOR SERVERA ----------
//
// Server je do sada živeo u prozoru "Pokreni server.bat": petlja koja ga
// podigne ponovo kad padne. To je hvatalo pad, i ništa drugo:
//
//   - prozor se zatvori jednim klikom na X, i server nestane do sutra
//   - server koji se ZAGLAVI (radi, a ne odgovara) petlja ne vidi - nije pao
//   - server koji pada odmah pri pokretanju (zauzet port, pokvaren fajl) se
//     diže u krug na tri sekunde, ceo dan, i puni zapis istom greškom
//
// Nadzornik je proces koji drži server, i sam ne radi ništa drugo - zato nema
// ni čime da padne. Pokreće ga zakazani zadatak pri paljenju računara, pre
// prijave na Windows i bez prozora (vidi "Podesi autostart.bat"), a ručno
// "Pokreni server.bat".
//
// Ovde je samo odlučivanje: kad ponovo pokrenuti, koliko čekati, kad proglasiti
// server zaglavljenim. Bez procesa, bez mreže i bez sata - sve to se ubacuje,
// pa se ponašanje proverava na brojkama (test-nadzornik.mjs).

// Čekanje pre ponovnog pokretanja posle pada, raste sa svakim padom zaredom.
// Server koji pada odmah ne sme da se diže u krug, a onaj koji je pao jednom
// treba da se vrati odmah.
export const ODMORI_MS = [1000, 2000, 5000, 10000, 30000, 60000];
// Server koji je radio ovoliko pa pao nije "pada u krug" - čekanje kreće iz početka.
export const STABILNO_MS = 10 * 60 * 1000;

// Provera zdravlja: server mora da odgovori na /api/zdravlje.
export const PRVA_PROVERA_MS = 30000;   // posle pokretanja: baza, održavanje, kopija
export const PROVERA_MS = 20000;
export const PROMASAJA_ZA_RESTART = 3;  // tri zaredom = zaglavljen, ne jedan spor odgovor

// Server javlja ovim kodom da je port zauzet - verovatno već radi drugi. To nije
// pad: ponovo se proba ređe i bez rasta čekanja, a zapis se ne puni.
export const KOD_PORT_ZAUZET = 3;
export const PORT_ZAUZET_ODMOR_MS = 30000;

// Koliko se čeka da server uredno završi (upis baze) pre nego što se ugasi silom.
export const UREDNO_GASENJE_MS = 10000;

/**
 * @param {object} o
 * @param {(razlog: string) => {pid?: number, naIzlaz: (cb: (kod: number|null) => void) => void, zamoli?: () => void}} o.pokreni
 * @param {() => Promise<boolean>} o.proveri   da li server odgovara
 * @param {(dete: object) => void} o.ubij        gašenje silom
 * @param {(razlog: string) => (string|Promise<string>)} [o.prePokretanja]
 *        posao pre svakog pokretanja (zamena koda pri nadogradnji); vraća razlog
 *        pod kojim se server pokreće
 * @param {() => number} [o.sat]
 * @param {(fn: Function, ms: number) => any} [o.zakazi]
 * @param {(t: any) => void} [o.otkazi]
 * @param {(tekst: string) => void} [o.log]
 */
export function napraviNadzornika({
  pokreni, proveri, ubij, prePokretanja = null,
  sat = Date.now, zakazi = setTimeout, otkazi = clearTimeout, log = () => {},
}) {
  let dete = null;
  let pokrenutoU = 0;
  let padovaZaredom = 0;
  let promasaja = 0;
  let proveraUToku = false;
  let pripremaUToku = false;
  let tajmerProvere = null;
  let tajmerPokretanja = null;
  let gasim = false;
  let krajGasenja = null;
  let pokretanja = 0;

  function zakaziProveru(ms) {
    otkazi(tajmerProvere);
    tajmerProvere = zakazi(proveriSad, ms);
  }

  async function proveriSad() {
    tajmerProvere = null;
    const zaDete = dete;
    if (!zaDete || gasim) return;
    // Spora provera ne sme da se preklopi sa sledećom - inače bi jedan zaglavljen
    // odgovor brojao kao tri promašaja.
    if (proveraUToku) { zakaziProveru(PROVERA_MS); return; }
    proveraUToku = true;
    let ok = false;
    try { ok = await proveri(); } catch { ok = false; }
    proveraUToku = false;
    if (dete !== zaDete || gasim || zaDete.ponovo) return; // pao je, gasi se, ili se namerno restartuje
    if (ok) {
      promasaja = 0;
    } else if (++promasaja >= PROMASAJA_ZA_RESTART) {
      log(`server ne odgovara ${promasaja} provere zaredom - gasim ga i dižem iznova`);
      promasaja = 0;
      zaDete.zaglavljen = true;
      ubij(zaDete);
      return; // izlaz deteta zakazuje ponovno pokretanje
    }
    zakaziProveru(PROVERA_MS);
  }

  function pokreniOdmah(razlog) {
    if (gasim) return;
    pokretanja++;
    promasaja = 0;
    pokrenutoU = sat();
    const d = pokreni(razlog);
    dete = d;
    d.naIzlaz((kod) => naIzlazDeteta(d, kod));
    zakaziProveru(PRVA_PROVERA_MS);
  }

  function pokreniSad(razlog) {
    tajmerPokretanja = null;
    if (gasim) return;
    if (!prePokretanja) { pokreniOdmah(razlog); return; }
    // Posao pre pokretanja (zamena koda) ume da traje. Za to vreme nema servera,
    // a ni drugog pokretanja.
    pripremaUToku = true;
    Promise.resolve()
      .then(() => prePokretanja(razlog))
      .catch((e) => { log(`posao pre pokretanja nije uspeo: ${String(e?.message || e).slice(0, 200)}`); return razlog; })
      .then((r) => { pripremaUToku = false; pokreniOdmah(r || razlog); });
  }

  function naIzlazDeteta(d, kod) {
    if (dete !== d) return;
    dete = null;
    otkazi(tajmerProvere);
    tajmerProvere = null;
    if (d.sila) otkazi(d.sila);
    if (gasim) {
      log("server je ugašen");
      if (krajGasenja) krajGasenja();
      return;
    }
    const radio = sat() - pokrenutoU;
    if (d.ponovo) {
      // Namerno ugašen (nadogradnja): diže se odmah i ne broji se kao pad.
      log(`server je ugašen radi ponovnog pokretanja (${d.ponovo})`);
      const razlog = d.ponovo;
      tajmerPokretanja = zakazi(() => pokreniSad(razlog), 0);
      return;
    }
    let ms, razlog;
    if (kod === KOD_PORT_ZAUZET) {
      ms = PORT_ZAUZET_ODMOR_MS;
      razlog = "port";
      log(`port je zauzet - verovatno već radi drugi server. Probam ponovo za ${ms / 1000} s`);
    } else {
      if (radio >= STABILNO_MS) padovaZaredom = 0;
      ms = ODMORI_MS[Math.min(padovaZaredom, ODMORI_MS.length - 1)];
      padovaZaredom++;
      razlog = d.zaglavljen ? "zaglavljen" : "pad";
      log(`server je ${d.zaglavljen ? "ugašen jer nije odgovarao" : `izašao (kod ${kod})`} posle ${Math.round(radio / 1000)} s - ` +
        `ponovo za ${ms / 1000} s`);
    }
    tajmerPokretanja = zakazi(() => pokreniSad(razlog), ms);
  }

  function zamoliIliUbij(d) {
    try { if (d.zamoli) d.zamoli(); else ubij(d); } catch { ubij(d); }
  }

  return {
    start(razlog = "start") { if (!dete && !tajmerPokretanja && !pripremaUToku && !gasim) pokreniSad(razlog); },

    // Uredan restart sa razlogom (nadogradnja): server se zamoli da izađe, a
    // posle izlaza se diže odmah - bez čekanja i bez brojanja kao pad.
    ponovo(razlog) {
      if (gasim || !dete || dete.ponovo) return false;
      const d = dete;
      d.ponovo = razlog;
      otkazi(tajmerProvere);
      tajmerProvere = null;
      d.sila = zakazi(() => {
        if (dete === d) { log("server se nije ugasio na vreme - gasim silom"); ubij(d); }
      }, UREDNO_GASENJE_MS);
      zamoliIliUbij(d);
      return true;
    },

    // Uredno gašenje: zamoli server da upiše bazu i izađe; ako ne izađe na
    // vreme, ugasi ga silom. Posle ovoga se ništa više ne pokreće.
    stani() {
      gasim = true;
      otkazi(tajmerPokretanja); tajmerPokretanja = null;
      otkazi(tajmerProvere); tajmerProvere = null;
      if (!dete) return Promise.resolve();
      const d = dete;
      return new Promise((resolve) => {
        if (d.sila) otkazi(d.sila);
        const sila = zakazi(() => { log("server se nije ugasio na vreme - gasim silom"); ubij(d); }, UREDNO_GASENJE_MS);
        krajGasenja = () => { otkazi(sila); krajGasenja = null; resolve(); };
        zamoliIliUbij(d);
      });
    },

    stanje() {
      return {
        radi: !!dete, pid: dete?.pid ?? null, padovaZaredom, promasaja, pokretanja, gasim,
        cekaPokretanje: !!tajmerPokretanja, pripremaUToku,
      };
    },
  };
}
