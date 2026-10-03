import { z } from "zod";

// ---- SEME ULAZNIH PORUKA ----
//
// Sve sto stigne spolja prolazi kroz semu PRE nego sto ga dotakne ijedna
// funkcija koja radi sa novcem, vremenom ili bazom. Do sada je svaka funkcija
// sama sebi bila provera ("String(x || "")", "Number(y) || 1") - sto radi dok
// se neko ne seti polja koje niko nije ocekivao.
//
// Dva sveta, dva pravila:
//
// WEBSOCKET (launcher na racunaru igraca) - STROGO. Za svaki tip poruke tacno
// se zna koja polja launcher salje; sve preko toga je poruka koju nije poslao
// nas launcher. Takva poruka se odbija cela i belezi. Jedini izuzetak su
// stavke porudzbine: tamo se visak (npr. "price") odbacuje i belezi, a
// porudzbina ide dalje po ceni iz baze - to je ponasanje koje vec postoji i
// koje testovi traze.
//
// HTTP (panel osoblja) - po TIPU. Panel salje vrednosti pravo iz polja za unos
// ("150", " 4321 ") i servis ih sam cisti i proverava opseg, sa porukama koje
// osoblje razume. Sema ovde ne ponavlja tu proveru nego zatvara ono sto servis
// ne ocekuje: objekat ili niz na mestu broja/teksta, tekst od sto hiljada
// znakova, nepoznatu komandu ili status.

// ---------- zajednicko ----------
const tekst = (max) => z.string().max(max);
// Broj zapisa (id) - pozitivan ceo broj, kao broj ili kao niz cifara iz adrese.
const brojZapisa = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9][0-9]{0,14}$/)]);
// Vrednost iz polja za unos: broj ili kratak tekst. Opseg proverava servis.
const skalarBroj = z.union([z.number(), tekst(40), z.null()]);
const daNe = z.union([z.boolean(), z.literal(0), z.literal(1)]);

// ---------- WEBSOCKET: poruke launchera ----------
//
// Granice duzina su sire od onoga sto launcher stvarno salje (on sam sece na
// 40/80/200 znakova) - sema je brana od zloupotrebe, ne pravopis. Slobodan
// tekst koji server ionako sece (opis kvara, ime igre) ima siroku granicu:
// predugacak opis se i do sada belezio skracen, a ne odbacivao.
export const KOMANDE_RACUNARA = ["shutdown", "restart", "logoff", "reboot_launcher"];

const stavkaPorudzbine = z.looseObject({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // Kolicina je broj; koliko komada stvarno prolazi (1..20) odlucuje server.
  qty: z.number().optional(),
});

const SEME_KLIJENTA = {
  login: z.strictObject({ t: z.literal("login"), username: tekst(128), password: tekst(256) }),
  logout: z.strictObject({ t: z.literal("logout") }),
  hello: z.strictObject({ t: z.literal("hello") }),
  heartbeat: z.strictObject({
    t: z.literal("heartbeat"),
    // Sekunde bez dodira tastature i misa (Windows). Negativno ne postoji.
    mirovanje: z.number().min(0).max(10 * 365 * 86400).optional(),
  }),
  unlock_pin: z.strictObject({ t: z.literal("unlock_pin"), pin: tekst(32) }),
  verify_pin: z.strictObject({ t: z.literal("verify_pin"), pin: tekst(32) }),
  order: z.strictObject({
    t: z.literal("order"),
    // Prazan spisak prolazi semu - servis na njega odgovara "Prazna porudzbina",
    // sto launcher ume da prikaze.
    items: z.array(stavkaPorudzbine).max(160),
    payment: z.enum(["credit", "cash"]).optional(),
    poId: tekst(64).nullish(),
    note: tekst(500).optional(),
  }),
  change_password: z.strictObject({ t: z.literal("change_password"), oldPassword: tekst(256), newPassword: tekst(256) }),
  moja_tekstura: z.strictObject({
    t: z.literal("moja_tekstura"),
    kljuc: tekst(40),
    jacina: tekst(20).nullish(),
    kretanje: tekst(20).nullish(),
  }),
  moj_profil: z.strictObject({ t: z.literal("moj_profil"), boja: tekst(30).optional(), okvir: tekst(30).optional() }),
  // Ishod tocka bira server. Poruka zato NEMA nijedno polje - "index",
  // "nagrada" i slicno su pokusaj da se ishod nametne.
  tocak_spin: z.strictObject({ t: z.literal("tocak_spin") }),
  game_start: z.strictObject({ t: z.literal("game_start"), gameId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }),
  igra_ne_radi: z.strictObject({ t: z.literal("igra_ne_radi"), igra: tekst(10000), razlog: z.enum(["nema", "folder", "greska"]).optional() }),
  klijent_problem: z.strictObject({ t: z.literal("klijent_problem"), vrsta: tekst(10000), opis: tekst(10000).optional() }),
  log_klijent: z.strictObject({ t: z.literal("log_klijent"), tekst: tekst(10000) }),
  sys_info: z.strictObject({
    t: z.literal("sys_info"),
    nics: z.array(z.strictObject({ ip: tekst(64).nullish(), mac: tekst(64).nullish() })).max(64).optional(),
    mac: tekst(64).optional(),
    fabrickiPin: z.boolean().optional(),
  }),
  install_status: z.strictObject({
    t: z.literal("install_status"),
    program: tekst(300),
    state: z.enum(["downloading", "installing", "done", "error"]),
    message: tekst(1000).nullish(),
  }),
  nadogradnja_status: z.strictObject({
    t: z.literal("nadogradnja_status"),
    verzija: tekst(40).nullish(),
    state: z.enum(["preskoceno", "preuzimam", "greska", "instaliram"]),
    message: tekst(1000).nullish(),
  }),
  // Odgovori na pitanja panela (daljinski task manager).
  procesi_lista: z.strictObject({
    t: z.literal("procesi_lista"),
    zahtev: z.number().int().positive(),
    spisak: z.array(z.strictObject({
      pid: z.number().int().nonnegative(),
      ime: tekst(500),
      putanja: tekst(2000).nullish(),
      memorija: z.number().nonnegative().nullish(),
      zasticen: z.boolean().optional(),
    })).max(5000),
    greska: tekst(500).optional(),
  }),
  proces_ugasen: z.strictObject({
    t: z.literal("proces_ugasen"),
    zahtev: z.number().int().positive(),
    ok: z.boolean(),
    ime: tekst(500).optional(),
    greska: tekst(500).optional(),
  }),
};

export const TIPOVI_KLIJENTA = Object.freeze(Object.keys(SEME_KLIJENTA));

// Sazetak greske za dnevnik: SAMO putanja i vrsta, nikad vrednost - u
// odbijenoj poruci moze da stoji lozinka ili PIN.
function sazmi(issues) {
  return issues.slice(0, 5).map((i) => {
    const s = { polje: i.path.length ? i.path.join(".") : "(poruka)", kod: i.code };
    if (i.code === "unrecognized_keys" && Array.isArray(i.keys)) s.visak = i.keys.slice(0, 10).map((k) => String(k).slice(0, 40));
    return s;
  });
}

// Proverava jednu vec procitanu (JSON) poruku sa racunara. Vraca:
//   { ok: true, tip, poruka, odbacena: [] }   poruka je ociscena kopija
//   { ok: false, razlog: "oblik" | "nepoznata" | "neispravna", tip, greske }
export function proveriKlijentskuPoruku(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { ok: false, razlog: "oblik", tip: null, greske: [] };
  const tip = msg.t;
  if (typeof tip !== "string" || !Object.hasOwn(SEME_KLIJENTA, tip)) {
    return { ok: false, razlog: "nepoznata", tip: typeof tip === "string" ? tip.slice(0, 40) : `(${tip === null ? "null" : typeof tip})`, greske: [] };
  }
  const r = SEME_KLIJENTA[tip].safeParse(msg);
  if (!r.success) return { ok: false, razlog: "neispravna", tip, greske: sazmi(r.error.issues) };

  let poruka = r.data;
  const odbacena = [];
  if (tip === "order") {
    // Visak u stavkama (cena, popust, ukupno...) se ne koristi - ali se
    // zapise, jer ga pravi launcher nikad ne salje.
    const items = poruka.items.map((it, i) => {
      for (const k of Object.keys(it)) if (k !== "id" && k !== "qty") odbacena.push(`items.${i}.${String(k).slice(0, 40)}`);
      return it.qty === undefined ? { id: it.id } : { id: it.id, qty: it.qty };
    });
    poruka = { ...poruka, items };
  }
  return { ok: true, tip, poruka, odbacena: odbacena.slice(0, 20) };
}

// ---------- HTTP: tela zahteva panela ----------
//
// z.looseObject: polja koja ruta ne cita se ne diraju (panel ume da posalje
// ceo objekat koji je dobio, npr. program sa id-jem i datumom), ali svako
// polje koje ruta CITA mora da bude ocekivanog tipa.
const telo = (oblik) => z.looseObject(oblik);

export const SEME_HTTP = {
  prijava: telo({ username: tekst(128).optional(), password: tekst(256).optional() }),
  mojaLozinka: telo({ oldPassword: tekst(256).optional(), newPassword: tekst(256).optional() }),
  noviRadnik: telo({
    username: tekst(128).optional(),
    password: tekst(256).optional(),
    role: z.enum(["staff", "owner", "serviser"]).optional(),
  }),
  lozinka: telo({ password: tekst(256).optional() }),
  noviIgrac: telo({
    username: tekst(128).optional(),
    password: tekst(256).optional(),
    displayName: tekst(128).nullish(),
    balance: skalarBroj.optional(),
    note: tekst(1000).nullish(),
  }),
  gosti: telo({ count: skalarBroj.optional(), balance: skalarBroj.optional() }),
  dopuna: telo({ amount: skalarBroj.optional(), note: tekst(500).nullish() }),
  prodajaPaketa: telo({ paketId: skalarBroj.optional() }),
  blokada: telo({ banned: daNe.optional() }),
  izmenaIgraca: telo({ username: tekst(128).optional(), displayName: tekst(128).nullish(), note: tekst(1000).nullish() }),
  tocak: telo({ ukljucen: daNe.optional(), prag: skalarBroj.optional() }),
  nagrada: telo({ naziv: tekst(100).optional(), kredit: skalarBroj.optional(), tezina: skalarBroj.optional() }),
  paket: telo({ name: tekst(100).optional(), hours: skalarBroj.optional(), price: skalarBroj.optional(), available: daNe.optional() }),
  otvoriSmenu: telo({ openingCash: skalarBroj.optional() }),
  zatvoriSmenu: telo({ closingCash: skalarBroj.optional() }),
  napomenaSmene: telo({ note: tekst(1000).nullish() }),
  porukaRacunaru: telo({ text: tekst(1000).optional() }),
  komanda: telo({ cmd: z.enum(KOMANDE_RACUNARA).optional() }),
  grupnaAkcija: telo({
    ids: z.array(brojZapisa).max(500).nullish(),
    action: z.enum(["lock", "unlock", "logout", ...KOMANDE_RACUNARA]).optional(),
  }),
  statusPorudzbine: telo({ status: z.enum(["pending", "preparing", "delivered", "cancelled"]).optional() }),
  kasa: telo({
    items: z.array(z.looseObject({ id: brojZapisa, qty: skalarBroj.optional() })).max(160).optional(),
    playerId: brojZapisa.nullish(),
    computerId: brojZapisa.nullish(),
    payment: z.enum(["cash", "credit"]).optional(),
    note: tekst(500).nullish(),
    poId: tekst(64).nullish(),
  }),
  podesavanja: telo({
    cafeName: z.union([tekst(200), z.number()]).nullish(),
    currency: z.union([tekst(20), z.number()]).nullish(),
    ratePerHour: skalarBroj.optional(),
    unlockPin: z.union([tekst(32), z.number()]).nullish(),
    servisniPin: z.union([tekst(32), z.number()]).nullish(),
    idleMinutes: skalarBroj.optional(),
  }),
  instalacija: telo({
    ids: z.array(brojZapisa).max(500).nullish(),
    programId: brojZapisa.nullish(),
    name: tekst(200).nullish(),
    // Racunari ce ovo preuzeti i POKRENUTI. Samo http(s) - nikad file:, ni
    // putanja na disku, ni nesto sto se pokrece samo od sebe.
    url: z.string().max(2000).regex(/^https?:\/\/[^\s]+$/i, "Link mora da počinje sa http:// ili https://").nullish(),
    args: tekst(500).nullish(),
  }),
  nadogradnjaPosalji: telo({ ids: z.array(brojZapisa).max(500).nullish() }),
};

// Express middleware: proveri telo zahteva semom. `prijavi` (ako je dat) dobija
// sazetak greske, da odbijanje zavrsi u bezbednosnom dnevniku.
export function proveriTelo(sema, prijavi = null) {
  return (req, res, next) => {
    const r = sema.safeParse(req.body ?? {});
    if (r.success) return next();
    const greske = sazmi(r.error.issues);
    if (prijavi) {
      try { prijavi(req, greske); } catch {}
    }
    const prva = r.error.issues[0];
    const polje = prva?.path?.length ? prva.path.join(".") : null;
    const poruka = prva?.code === "invalid_format" && prva?.message && !/^Invalid/.test(prva.message) ? prva.message : null;
    return res.status(400).json({ error: poruka || (polje ? `Neispravna vrednost polja "${polje}"` : "Neispravan zahtev") });
  };
}
