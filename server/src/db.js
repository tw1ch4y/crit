import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CRIT_DATA_DIR omogućava izolovanu instancu (test/staging) bez diranja glavne baze
export const DATA_DIR = process.env.CRIT_DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "crit.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ---- JEDAN POSAO, JEDAN UPIS ----
//
// Porudžbina nije jedan upis nego pet: red u orders, stavke, skidanje zalihe,
// novo stanje kredita i zapis u transactions. Bez ovoga svaki od njih sam sebe
// potvrđuje, pa nestanak struje između trećeg i četvrtog ostavlja igraonicu u
// stanju u kom je piće skinuto sa stanja, a kredit nije naplaćen. Nestanak
// struje je ovde najizvesniji događaj, pa to nije teorija.
//
// SAVEPOINT umesto BEGIN: SQLite ne dozvoljava BEGIN unutar BEGIN-a, a poslovi
// se pozivaju jedan iz drugog (prodaja paketa zove dopunu kredita). Sa
// savepoint-ima se ugnežđivanje ponaša ispravno.
let dubinaPosla = 0;
export function uJednomPoslu(fn) {
  const ime = `p${dubinaPosla}`;
  dubinaPosla++;
  db.exec(dubinaPosla === 1 ? "BEGIN" : `SAVEPOINT ${ime}`);
  try {
    const r = fn();
    db.exec(dubinaPosla === 1 ? "COMMIT" : `RELEASE ${ime}`);
    dubinaPosla--;
    return r;
  } catch (e) {
    try { db.exec(dubinaPosla === 1 ? "ROLLBACK" : `ROLLBACK TO ${ime}`); } catch {}
    dubinaPosla--;
    throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',   -- owner | staff
  active        INTEGER NOT NULL DEFAULT 1,      -- 0 = ugašen nalog (otpušten radnik)
  created_at    INTEGER NOT NULL
);

-- prijave na panel prezive restart servera
CREATE TABLE IF NOT EXISTS admin_tokens (
  token      TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  balance       REAL NOT NULL DEFAULT 0,          -- kredit u dinarima
  banned        INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER
);

CREATE TABLE IF NOT EXISTS computers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT UNIQUE NOT NULL,             -- npr PC-01
  token         TEXT UNIQUE NOT NULL,             -- za registraciju klijenta
  status        TEXT NOT NULL DEFAULT 'offline',  -- offline | locked | idle | in_use
  current_player_id  INTEGER REFERENCES players(id),
  current_session_id INTEGER REFERENCES sessions(id),
  last_seen     INTEGER,
  pos_x         INTEGER DEFAULT 0,
  pos_y         INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    INTEGER NOT NULL REFERENCES players(id),
  computer_id  INTEGER NOT NULL REFERENCES computers(id),
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  cost         REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active'     -- active | ended
);

CREATE TABLE IF NOT EXISTS shop_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Ostalo',
  price      REAL NOT NULL,
  emoji      TEXT DEFAULT '',
  available  INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER REFERENCES players(id),      -- može biti NULL za keš/walk-in
  computer_id INTEGER REFERENCES computers(id),
  total       REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',      -- pending | preparing | delivered | cancelled
  payment     TEXT NOT NULL DEFAULT 'credit',       -- credit | cash
  source      TEXT NOT NULL DEFAULT 'client',       -- client | pos
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id   INTEGER REFERENCES shop_items(id),
  name      TEXT NOT NULL,
  price     REAL NOT NULL,
  qty       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    INTEGER NOT NULL REFERENCES players(id),
  type         TEXT NOT NULL,                     -- topup | session | shop | refund | adjust
  amount       REAL NOT NULL,                     -- + dodato, - skinuto
  balance_after REAL NOT NULL,
  admin_id     INTEGER REFERENCES admins(id),
  note         TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  category  TEXT NOT NULL,     -- prijava | sesija | novac | shop | racunar | nalozi | podesavanja | sistem
  action    TEXT NOT NULL,
  actor     TEXT,              -- ko je izvršio (radnik/vlasnik/igrač/sistem)
  target    TEXT,              -- nad čim (računar, igrač...)
  detail    TEXT,              -- opis
  amount    REAL
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);

CREATE TABLE IF NOT EXISTS shifts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id       INTEGER REFERENCES admins(id),
  admin_username TEXT,
  opened_at      INTEGER NOT NULL,
  closed_at      INTEGER,
  opening_cash   REAL NOT NULL DEFAULT 0,        -- početno stanje kase
  closing_cash   REAL,                            -- prebrojano na kraju (opciono)
  total_topups   REAL,                            -- dopune (novac +)
  total_deducts  REAL,                            -- skidanja/ispravke (novac -)
  total_shop     REAL,                            -- ukupno shop
  total_revenue  REAL,                            -- ukupan promet
  status         TEXT NOT NULL DEFAULT 'open',    -- open | closed
  note           TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  path      TEXT NOT NULL,                        -- putanja do .exe ili URL
  args      TEXT DEFAULT '',
  emoji     TEXT DEFAULT '',
  category  TEXT DEFAULT 'Igre',
  sort      INTEGER DEFAULT 0
);

-- Svako pokretanje igre iz launchera. Sluzi za dve stvari: igracu da mu se
-- omiljene igre nadju prve, vlasniku da vidi sta se stvarno igra pre nego sto
-- kupi jos licenci ili oslobodi prostor na disku.
CREATE TABLE IF NOT EXISTS game_launches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL,
  player_id   INTEGER,
  computer_id INTEGER,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gl_player ON game_launches (player_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_gl_at ON game_launches (at DESC);

-- Promo baneri na vrhu pocetne u launcheru. Vise njih se smenjuje samo od
-- sebe; kad ih nema, hero pokazuje izdvojenu igru kao i ranije.
CREATE TABLE IF NOT EXISTS promo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  image      TEXT NOT NULL,
  naziv      TEXT,
  available  INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS programs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,                        -- direktan link do instalacije
  args       TEXT DEFAULT '',                      -- tihi argumenti (npr. /S /silent)
  note       TEXT,
  created_at INTEGER NOT NULL
);

-- Alati/prečice u launcheru (Internet sekcija) - kojima osoblje upravlja iz panela.
-- kind = 'web' (otvara pravi pregledač / Chrome) ili 'app' (pokreće .exe/protokol).
CREATE TABLE IF NOT EXISTS tools (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'web',          -- web | app
  target     TEXT NOT NULL DEFAULT '',             -- URL (web) ili putanja/protokol (app)
  args       TEXT DEFAULT '',
  image      TEXT,                                 -- cover slika
  color      TEXT,                                 -- akcenat (opciono)
  available  INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Vremenski paketi: jeftinije vreme kupljeno unapred (npr. 5h za 500 din).
-- Pri prodaji se igraču doda kredit = sati * cena po satu (u tom trenutku), a
-- naplati se 'price'. Razlika je popust. Novac koji je ušao vodi se kao dopuna.
CREATE TABLE IF NOT EXISTS paketi (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  hours      REAL NOT NULL,                        -- koliko sati vremena daje
  price      REAL NOT NULL,                        -- koliko igrač plaća
  available  INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Nagradni točak: igrač koji je za nedelju dana potrošio dovoljno može jednom
-- da zavrti i osvoji kredit. Segmenti (nagrade) su podesivi, sa težinom koja
-- određuje koliko su česti. Ishod BIRA SERVER (težinski nasumično), klijent
-- samo animira do rezultata - da igrač ne može da namesti.
CREATE TABLE IF NOT EXISTS tocak_nagrade (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  naziv  TEXT NOT NULL,                            -- npr "100 din", "Ništa"
  kredit REAL NOT NULL DEFAULT 0,                  -- koliko kredita daje (0 = prazno polje)
  tezina INTEGER NOT NULL DEFAULT 1,               -- veći broj = češće pada
  sort   INTEGER DEFAULT 0
);
`);

// ---- Migracije (dodavanje kolona na postojeću bazu bez brisanja) ----
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
function migrate() {
  // Ugasen nalog (otpusten radnik). Ne brise se, jer smene i promet moraju da
  // znaju KO je sta uradio - bez toga obracun smene nema smisla.
  if (!columnExists("admins", "active")) db.exec("ALTER TABLE admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  if (!columnExists("shop_items", "image")) db.exec("ALTER TABLE shop_items ADD COLUMN image TEXT");
  if (!columnExists("orders", "payment")) db.exec("ALTER TABLE orders ADD COLUMN payment TEXT NOT NULL DEFAULT 'credit'");
  if (!columnExists("orders", "source")) db.exec("ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'client'");
  if (!columnExists("logs", "shift_id")) db.exec("ALTER TABLE logs ADD COLUMN shift_id INTEGER");
  if (!columnExists("computers", "ip")) db.exec("ALTER TABLE computers ADD COLUMN ip TEXT");
  if (!columnExists("computers", "mac")) db.exec("ALTER TABLE computers ADD COLUMN mac TEXT"); // za Wake-on-LAN
  if (!columnExists("games", "image")) db.exec("ALTER TABLE games ADD COLUMN image TEXT");
  if (!columnExists("games", "banner")) db.exec("ALTER TABLE games ADD COLUMN banner TEXT");
  if (!columnExists("games", "available")) db.exec("ALTER TABLE games ADD COLUMN available INTEGER NOT NULL DEFAULT 1");
  if (!columnExists("shop_items", "stock")) db.exec("ALTER TABLE shop_items ADD COLUMN stock INTEGER"); // NULL = neograničeno
  // Igračeva pozadina: šara koju je sam izabrao u launcheru, na svom nalogu.
  // Čuva se kao tekst (JSON) jer su to tri sitna izbora koja se ne pretražuju.
  if (!columnExists("players", "tema")) db.exec("ALTER TABLE players ADD COLUMN tema TEXT");
  // Verzija launchera na tom računaru. Bez nje se u igraonici sa 13 mašina ne
  // može znati koja je gde instalirana - jedan računar se ponaša drugačije, a
  // nigde ne piše zašto. Upisuje se pri svakom povezivanju.
  if (!columnExists("computers", "launcher_version")) db.exec("ALTER TABLE computers ADD COLUMN launcher_version TEXT");
  // Numeracija verzija koju launcher javlja uz verziju (vidi verzije.js).
  // 0 = stara numeracija, ili launcher koji se nikad nije javio.
  if (!columnExists("computers", "launcher_numeracija")) {
    db.exec("ALTER TABLE computers ADD COLUMN launcher_numeracija INTEGER NOT NULL DEFAULT 0");
  }
  // Da li je servisni PIN launchera na toj masini jos fabricki (1234). NULL =
  // launcher to ne javlja (starija verzija), sto NIJE isto sto i "u redu je".
  if (!columnExists("computers", "pin_fabricki")) db.exec("ALTER TABLE computers ADD COLUMN pin_fabricki INTEGER");
  // konačne brojke smene se čuvaju pri zatvaranju (da se ne preračunavaju iz logova)
  if (!columnExists("shifts", "total_shop_cash")) db.exec("ALTER TABLE shifts ADD COLUMN total_shop_cash REAL");
  if (!columnExists("shifts", "total_sessions")) db.exec("ALTER TABLE shifts ADD COLUMN total_sessions REAL");
  // Kad je igrač poslednji put zavrteo nagradni točak - da ne može više puta nedeljno.
  if (!columnExists("players", "last_spin_at")) db.exec("ALTER TABLE players ADD COLUMN last_spin_at INTEGER");
  // ISKUSTVO: jedan potrosen dinar = jedan XP. Stoji na igracu, ne racuna se iz
  // prometa - promet se sece pri odrzavanju (stari logovi se brisu), pa bi se
  // nivo igraca tiho vratio unazad onog dana kad odrzavanje prodje.
  if (!columnExists("players", "xp")) db.exec("ALTER TABLE players ADD COLUMN xp REAL NOT NULL DEFAULT 0");
  // Izgled profila: boja imena i okvir oko znaka. Kao tekst (JSON), jer su to
  // dva sitna izbora koja se ne pretrazuju. Odvojeno od `tema` (sara) da se
  // citanje sare ne kvari kad se doda jos nesto na profil.
  if (!columnExists("players", "profil")) db.exec("ALTER TABLE players ADD COLUMN profil TEXT");
  // TOČAK: koliko puta je vrteo i koliko je ukupno dobio.
  //
  // `last_spin_at` pamti samo POSLEDNJI spin, a značke traže broj. Broj se ne
  // može izvući ni iz `transactions` (spin bez dobitka ne upisuje ništa) ni iz
  // logova (održavanje ih seče po starosti, pa bi značka "10 spinova" jednog
  // dana tiho nestala sa profila gosta koji je stvarno vrteo trideset puta).
  // Zato stoji na igraču, kao i XP, i iz istog razloga.
  if (!columnExists("players", "spinova")) db.exec("ALTER TABLE players ADD COLUMN spinova INTEGER NOT NULL DEFAULT 0");
  if (!columnExists("players", "spin_dobitak")) db.exec("ALTER TABLE players ADD COLUMN spin_dobitak REAL NOT NULL DEFAULT 0");
  // VIP: DOKLE vazi clanarina, ne da li je aktivna.
  //
  // Zastavica "jeste/nije" bi trazila da neko svakog dana prolazi kroz sve
  // naloge i gasi istekle - a taj posao se preskoci onog dana kad server ne radi,
  // pa gost ostane VIP zauvek. Rok se ne kvari: prosao je ili nije.
  if (!columnExists("players", "vip_do")) db.exec("ALTER TABLE players ADD COLUMN vip_do INTEGER");
  // OBRISAN NALOG (vreme brisanja). Nalog se ne briše fizički: uz njega idu
  // transakcije i sesije iz kojih se računaju izveštaji. Vidi deletePlayer.
  if (!columnExists("players", "obrisan")) db.exec("ALTER TABLE players ADD COLUMN obrisan INTEGER");
  // Isto za računar: uz njega idu sesije i porudžbine. Vidi obrisiRacunar.
  if (!columnExists("computers", "obrisan")) db.exec("ALTER TABLE computers ADD COLUMN obrisan INTEGER");
  // KOLIKO JE SEKUNDI SESIJE NAPLAĆENO.
  //
  // Launcher broji sekunde i dok servera nema, pa kad se vrati javi koliko je
  // sesija ukupno trajala. Naplaćuje se razlika između toga i ovoga - bez
  // poređenja satova dva računara, i bez duple naplate kad isti izveštaj stigne
  // dvaput. Iz `cost` se ovo ne može izvući: cena po satu se menja, a naplata
  // staje na nuli kredita. Vidi server/src/offline.js.
  if (!columnExists("sessions", "sekundi")) db.exec("ALTER TABLE sessions ADD COLUMN sekundi REAL NOT NULL DEFAULT 0");

  // KVAR OSTAJE ZAPISAN UZ SAMU IGRU, NE SAMO U LOGOVIMA.
  //
  // Kad igra neće da se pokrene, launcher to javi serveru - ali se do sada
  // završavalo kao jedan red u Logovima i kratka poruka koja prođe preko ekrana.
  // Vlasnik je to video samo ako je baš u tom trenutku gledao u panel.
  //
  // A najčešći uzrok je prečica koja fali na JEDNOJ mašini od trinaest: gost
  // slegne ramenima i pokrene nešto drugo, niko ne prijavi, i tako mesecima.
  // Zato poslednji neuspeh stoji na samom redu - vlasnik otvori Igre i vidi
  // koja, gde i zašto.
  //
  // Pamti se samo POSLEDNJI: spisak svih neuspeha je posao logova, a ovde treba
  // odgovor na jedno pitanje - radi li ova stavka sada.
  for (const tabela of ["games", "tools"]) {
    if (!columnExists(tabela, "kvar_kad")) db.exec(`ALTER TABLE ${tabela} ADD COLUMN kvar_kad INTEGER`);
    if (!columnExists(tabela, "kvar_razlog")) db.exec(`ALTER TABLE ${tabela} ADD COLUMN kvar_razlog TEXT`);
    if (!columnExists(tabela, "kvar_gde")) db.exec(`ALTER TABLE ${tabela} ADD COLUMN kvar_gde TEXT`);
  }
}
migrate();

// ---- Helpers za settings ----
export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

// ---- Seed pri prvom pokretanju ----
function seed() {
  const defaults = {
    cafe_name: "Crit",
    currency: "RSD",
    rate_per_hour: "120", // dinara na sat
    unlock_pin: "1234", // PIN koji osoblje kuca da otkljuca racunar
    // Šara i animacija su uključene od početka - inače sveža igraonica izgleda
    // ravno i niko ne zna da to postoji dok ne pretraži podešavanja. Postavlja
    // se SAMO ako ključ nikad nije upisan: ko je namerno izabrao "bez šare",
    // njegov izbor ostaje (getSetting vrati "nema", nije null, pa se preskoči).
    tekstura: "crit",
    tekstura_jacina: "srednje",
    tekstura_kretanje: "talas",
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (getSetting(k) === null) setSetting(k, v);
  }

  const adminCount = db.prepare("SELECT COUNT(*) c FROM admins").get().c;
  if (adminCount === 0) {
    db.prepare(
      "INSERT INTO admins (username, password_hash, role, created_at) VALUES (?, ?, 'owner', ?)"
    ).run("admin", hashPassword("admin"), Date.now());
    console.log("Kreiran vlasnik nalog: admin / admin (OBAVEZNO promeniti sifru!)");
  }

  const compCount = db.prepare("SELECT COUNT(*) c FROM computers").get().c;
  if (compCount === 0) {
    const insert = db.prepare(
      "INSERT INTO computers (name, token, status, pos_x, pos_y) VALUES (?, ?, 'offline', ?, ?)"
    );
    for (let i = 1; i <= 13; i++) {
      const col = (i - 1) % 5;
      const row = Math.floor((i - 1) / 5);
      insert.run(`PC-${String(i).padStart(2, "0")}`, `pc${i}-${randomToken()}`, col, row);
    }
    console.log("Kreirano 13 racunara (PC-01 ... PC-13)");
  }

  const shopCount = db.prepare("SELECT COUNT(*) c FROM shop_items").get().c;
  if (shopCount === 0) {
    const insert = db.prepare(
      "INSERT INTO shop_items (name, category, price, emoji, sort) VALUES (?, ?, ?, ?, ?)"
    );
    const items = [
      ["Coca-Cola 0.5", "Pića", 130, "", 1],
      ["Voda 0.5", "Pića", 80, "", 2],
      ["Red Bull", "Energetska", 250, "", 3],
      ["Sok Next", "Pića", 120, "", 4],
      ["Čips", "Grickalice", 150, "", 5],
      ["Smoki", "Grickalice", 100, "", 6],
      ["Sendvič", "Hrana", 300, "", 7],
      ["Kafa", "Topli napici", 120, "", 8],
    ];
    for (const it of items) insert.run(...it);
    console.log("Ubacen primer shop artikala");
  }

  // BIBLIOTEKA INSTALACIJA
  // Strana "Instalacije" je bila prazna, pa je vlasnik morao sam da trazi
  // linkove i tihe argumente za svaki program. Ovo su programi koji trebaju
  // svakoj igraonici. Svaki link je proveren da stvarno vraca instalaciju, ne
  // HTML stranicu - mrtav link je gori od prazne strane, jer radnik klikne
  // "Instaliraj" i dobije gresku nasred smene.
  //
  // Tihi argumenti se razlikuju po tome cime je instalacija pravljena:
  //   NSIS -> /S     Inno -> /silent     MSI -> /qn
  const progCount = db.prepare("SELECT COUNT(*) c FROM programs").get().c;
  if (progCount === 0) {
    const ins = db.prepare("INSERT INTO programs (name, url, args, note, created_at) VALUES (?,?,?,?,?)");
    const now = Date.now();
    const defs = [
      ["Steam", "https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe", "/S",
        "Osnovni pokretač igara. Instalira se tiho."],
      ["Epic Games Launcher", "https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi", "/qn",
        "MSI paket - klijent ga sam pokreće kroz msiexec."],
      ["Discord", "https://discord.com/api/downloads/distributions/app/installers/latest?channel=stable&platform=win&arch=x64", "-s",
        "Oko 150 MB. Instalira se u nalog korisnika, ne traži administratora."],
      ["Google Chrome", "https://dl.google.com/chrome/install/latest/chrome_installer.exe", "/silent /install",
        "Traži administratorska prava."],
      ["Mozilla Firefox", "https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=en-US", "/S",
        "Pun instalator, oko 90 MB."],
      ["7-Zip", "https://www.7-zip.org/a/7z2408-x64.exe", "/S",
        "Otvaranje arhiva. Link nosi broj verzije - proveri ga kad izađe nova."],
      ["Battle.net", "https://www.battle.net/download/getInstallerForGame?os=win&gameProgram=BATTLENET_APP&version=Live", "",
        "PAŽNJA: Blizzard nema tihu instalaciju. Otvara se prozor na računaru igrača i neko mora da klikne kroz njega."],
    ];
    for (const d of defs) ins.run(d[0], d[1], d[2], d[3], now);
    console.log(`Ubacena biblioteka instalacija (${defs.length} programa)`);
  }

  const toolCount = db.prepare("SELECT COUNT(*) c FROM tools").get().c;
  if (toolCount === 0) {
    const ins = db.prepare("INSERT INTO tools (name, kind, target, sort, created_at) VALUES (?,?,?,?,?)");
    const now = Date.now();
    const defs = [
      ["Steam", "web", "https://store.steampowered.com"],
      ["YouTube", "web", "https://www.youtube.com"],
      ["Discord", "web", "https://discord.com/app"],
      ["Google", "web", "https://www.google.com"],
      ["Twitch", "web", "https://www.twitch.tv"],
    ];
    defs.forEach((d, i) => ins.run(d[0], d[1], d[2], i, now));
    console.log("Ubacen primer internet alata");
  }

  // Podrazumevani vremenski paket - baš onaj koji je tražen: 5h za 500 din.
  const paketCount = db.prepare("SELECT COUNT(*) c FROM paketi").get().c;
  if (paketCount === 0) {
    db.prepare("INSERT INTO paketi (name, hours, price, available, sort, created_at) VALUES (?,?,?,1,1,?)")
      .run("5 sati", 5, 500, Date.now());
    console.log("Ubacen primer vremenskog paketa (5h za 500)");
  }

  // Nagradni točak: podrazumevani prag i nagrade. Isključen dok ga vlasnik ne
  // upali - da ne deli kredit pre nego što odluči šta i koliko.
  if (getSetting("tocak_ukljucen") === null) setSetting("tocak_ukljucen", "0");
  if (getSetting("tocak_prag") === null) setSetting("tocak_prag", "1200");
  const nagCount = db.prepare("SELECT COUNT(*) c FROM tocak_nagrade").get().c;
  if (nagCount === 0) {
    const ins = db.prepare("INSERT INTO tocak_nagrade (naziv, kredit, tezina, sort) VALUES (?,?,?,?)");
    // Težina = koliko često pada. Najveća nagrada je retka, da ostane vredna.
    const nagrade = [
      ["30 din", 30, 28, 1],
      ["Ništa", 0, 24, 2],
      ["60 din", 60, 21, 3],
      ["Ništa", 0, 16, 4],
      ["120 din", 120, 8, 5],
      ["250 din", 250, 3, 6],
    ];
    for (const n of nagrade) ins.run(...n);
    console.log("Ubacene podrazumevane nagrade za točak");
  }
}

export function randomToken(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

seed();

export function checkpoint() {
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch {}
}
