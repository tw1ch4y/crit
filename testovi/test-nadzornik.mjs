import { brojac } from "./_okruzenje.mjs";
import * as N from "../server/src/nadzor.js";
// NADZORNIK SERVERA - ODLUKE, BEZ PROCESA I BEZ SATA
//
// Nadzornik drži server: diže ga posle pada, gasi i diže kad se zaglavi, i
// gasi ga uredno. Ovde se proveravaju samo njegove odluke, sa lažnim satom i
// lažnim serverom, jer se bez toga ne vidi ono što je bitno:
//
//   - server koji je pao jednom vraća se za sekundu
//   - server koji pada u krug čeka sve duže, a ne diže se ceo dan na 3 s
//   - zauzet port nije pad (drugi server već radi) - ne diže se u krug
//   - tri promašaja zaredom su zastoj, dva nisu, a promašaji se broje zaredom
//   - gašenje prvo zamoli server da upiše bazu, pa tek onda silom
//   - posle gašenja se ništa ne diže
//
// Sa pravim serverom i pravim procesima to meri test-nadzornik-uzivo.mjs.
const { proveri, kraj } = brojac();

function svet({ zdravlje = () => true, prePokretanja = null } = {}) {
  let sada = 0;
  let sledeciId = 1;
  const tajmeri = [];
  const deca = [];
  const ubijeni = [];
  const zapis = [];
  const w = {
    get sada() { return sada; },
    deca, ubijeni, zapis,
    zdravlje,
    async napred(ms) {
      const cilj = sada + ms;
      for (;;) {
        tajmeri.sort((a, b) => a.kad - b.kad || a.id - b.id);
        const t = tajmeri[0];
        if (!t || t.kad > cilj) break;
        tajmeri.shift();
        sada = t.kad;
        t.fn();
        await new Promise((r) => setImmediate(r));
      }
      sada = cilj;
      await new Promise((r) => setImmediate(r));
    },
  };
  w.nadzor = N.napraviNadzornika({
    prePokretanja,
    sat: () => sada,
    zakazi: (fn, ms) => { const t = { kad: sada + ms, fn, id: sledeciId++ }; tajmeri.push(t); return t; },
    otkazi: (t) => { const i = tajmeri.indexOf(t); if (i >= 0) tajmeri.splice(i, 1); },
    log: (x) => zapis.push(x),
    pokreni: (razlog) => {
      let cb = null;
      const d = {
        razlog, pid: 100 + deca.length, zamoljen: false,
        naIzlaz: (f) => { cb = f; },
        izadji: (kod) => { if (cb) cb(kod); },
        zamoli() { d.zamoljen = true; },
      };
      deca.push(d);
      return d;
    },
    proveri: async () => w.zdravlje(),
    ubij: (d) => { ubijeni.push(d.pid); d.izadji(null); },
  });
  return w;
}

// ---- 1) POKRETANJE ----
let w = svet();
w.nadzor.start();
proveri("pri pokretanju diže server jednom", w.deca.length === 1 && w.deca[0].razlog === "start");
w.nadzor.start();
proveri("drugi start ne diže drugi server", w.deca.length === 1);

// ---- 2) PAD ----
w.deca[0].izadji(1);
await w.napred(900);
proveri("posle pada ne diže u istoj sekundi", w.deca.length === 1);
await w.napred(200);
proveri("posle pada diže ponovo za sekundu", w.deca.length === 2 && w.deca[1].razlog === "pad");
proveri("pad je zapisan", w.zapis.some((x) => /izašao \(kod 1\)/.test(x)));

// ---- 3) PADA U KRUG ----
const razmaci = [];
for (let i = 0; i < 7; i++) {
  const pre = w.deca.length, od = w.sada;
  w.deca.at(-1).izadji(1);
  let cekano = 0;
  while (w.deca.length === pre && cekano < 120000) { await w.napred(500); cekano += 500; }
  razmaci.push(w.sada - od);
}
proveri("server koji pada u krug čeka sve duže, do minuta",
  JSON.stringify(razmaci) === JSON.stringify([2000, 5000, 10000, 30000, 60000, 60000, 60000]), JSON.stringify(razmaci));

await w.napred(N.STABILNO_MS + 1000);
const preStabilnog = w.deca.length;
w.deca.at(-1).izadji(1);
await w.napred(1000);
proveri("server koji je dugo radio pa pao vraća se odmah", w.deca.length === preStabilnog + 1);

// ---- 4) ZAUZET PORT ----
w = svet();
w.nadzor.start();
w.deca[0].izadji(N.KOD_PORT_ZAUZET);
await w.napred(N.PORT_ZAUZET_ODMOR_MS - 500);
proveri("zauzet port ne diže server u krug", w.deca.length === 1);
await w.napred(1000);
proveri("nego proba ponovo posle pola minuta", w.deca.length === 2 && w.deca[1].razlog === "port");
w.deca[1].izadji(N.KOD_PORT_ZAUZET);
await w.napred(N.PORT_ZAUZET_ODMOR_MS + 10);
proveri("i čekanje zbog porta ne raste", w.deca.length === 3);
proveri("i ne broji se kao pad", w.nadzor.stanje().padovaZaredom === 0);
proveri("zapis kaže zašto", w.zapis.some((x) => /port je zauzet/.test(x)));

// ---- 5) ZASTOJ ----
let zdrav = true;
w = svet({ zdravlje: () => zdrav });
w.nadzor.start();
await w.napred(N.PRVA_PROVERA_MS + N.PROVERA_MS * 5);
proveri("zdrav server se ne dira", w.ubijeni.length === 0 && w.deca.length === 1);
zdrav = false;
await w.napred(N.PROVERA_MS * 2 + 10);
proveri("dva promašaja nisu zastoj", w.ubijeni.length === 0);
zdrav = true;
await w.napred(N.PROVERA_MS + 10);
zdrav = false;
await w.napred(N.PROVERA_MS * 2 + 10);
proveri("promašaji se broje zaredom, ne ukupno", w.ubijeni.length === 0);
await w.napred(N.PROVERA_MS + 10);
proveri("tri zaredom su zastoj: server se gasi", w.ubijeni.length === 1);
zdrav = true;
await w.napred(1100);
proveri("i diže iznova, sa razlogom", w.deca.length === 2 && w.deca[1].razlog === "zaglavljen");
proveri("zastoj je zapisan", w.zapis.some((x) => /ne odgovara/.test(x)));

// ---- 6) PROVERA KOJA VISI ----
let pusti = null;
w = svet({ zdravlje: () => new Promise((r) => { pusti = r; }) });
w.nadzor.start();
await w.napred(N.PRVA_PROVERA_MS + 10); // provera je poslata i visi
w.deca[0].izadji(1);
await w.napred(1100);
proveri("pad dok provera visi i dalje diže server", w.deca.length === 2);
pusti(false);
await w.napred(10);
proveri("zakasneo odgovor za stari server se ne računa novom", w.ubijeni.length === 0 && w.nadzor.stanje().promasaja === 0);

// ---- 7) GAŠENJE ----
w = svet();
w.nadzor.start();
let reseno = false;
w.nadzor.stani().then(() => { reseno = true; });
proveri("gašenje prvo zamoli server da upiše bazu", w.deca[0].zamoljen === true && w.ubijeni.length === 0);
w.deca[0].izadji(0);
await w.napred(10);
proveri("i završi se kad server izađe", reseno);
await w.napred(120000);
proveri("posle gašenja ništa se ne diže", w.deca.length === 1);

w = svet();
w.nadzor.start();
let reseno2 = false;
w.nadzor.stani().then(() => { reseno2 = true; });
await w.napred(N.UREDNO_GASENJE_MS - 100);
proveri("server koji se gasi dobija vremena", w.ubijeni.length === 0);
await w.napred(200);
proveri("a ako ne izađe na vreme, gasi se silom", w.ubijeni.length === 1);
await w.napred(10);
proveri("i gašenje se ipak završi", reseno2);

w = svet();
w.nadzor.start();
w.deca[0].izadji(1);
await w.nadzor.stani();
await w.napred(120000);
proveri("gašenje otkazuje zakazano ponovno pokretanje", w.deca.length === 1 && !w.nadzor.stanje().cekaPokretanje);

// ---- 8) POSAO PRE POKRETANJA (zamena koda pri nadogradnji) ----
let pustiPripremu = null;
const pozivi = [];
w = svet({ prePokretanja: (razlog) => { pozivi.push(razlog); return new Promise((r) => { pustiPripremu = r; }); } });
w.nadzor.start();
await w.napred(10);
proveri("pre pokretanja se čeka posao (zamena koda)", w.deca.length === 0 && pozivi[0] === "start");
w.nadzor.start();
await w.napred(10);
proveri("i za to vreme se ne pokreće drugi", w.deca.length === 0 && pozivi.length === 1);
pustiPripremu("vracena");
await w.napred(10);
proveri("server se pokreće pod razlogom koji je posao vratio", w.deca.length === 1 && w.deca[0].razlog === "vracena");

w = svet({ prePokretanja: () => { throw new Error("disk"); } });
w.nadzor.start();
await w.napred(10);
proveri("posao koji pukne ne ostavlja igraonicu bez servera", w.deca.length === 1 && w.deca[0].razlog === "start");
proveri("i to je zapisano", w.zapis.some((x) => /nije uspeo: disk/.test(x)));

// ---- 9) NAMERAN RESTART (nadogradnja) ----
w = svet({ prePokretanja: (r) => r });
w.nadzor.start();
await w.napred(10);
proveri("restart sa razlogom prvo zamoli server da se ugasi", w.nadzor.ponovo("nadogradnja") === true && w.deca[0].zamoljen);
proveri("dok se gasi, drugi zahtev se ne prima", w.nadzor.ponovo("nadogradnja") === false);
w.deca[0].izadji(0);
await w.napred(10);
proveri("posle izlaza diže se odmah, sa tim razlogom", w.deca.length === 2 && w.deca[1].razlog === "nadogradnja");
proveri("i ne broji se kao pad", w.nadzor.stanje().padovaZaredom === 0);
w.nadzor.ponovo("nadogradnja");
await w.napred(N.UREDNO_GASENJE_MS + 10);
proveri("server koji se ne ugasi na vreme gasi se silom", w.ubijeni.includes(w.deca[1].pid));
await w.napred(10);
proveri("i opet se diže", w.deca.length === 3);

w = svet({ prePokretanja: () => new Promise((r) => { pustiPripremu = r; }) });
w.nadzor.start();
await w.napred(10);
await w.nadzor.stani();
pustiPripremu("start");
await w.napred(10);
proveri("gašenje usred posla pre pokretanja ne pokreće server", w.deca.length === 0);

await kraj();
