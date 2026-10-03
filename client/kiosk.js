// ZASTITA KIOSKA - odluke bez Electron-a.
//
// Ovde su pravila koja odlucuju sta igrac sme: koji taster stize do ekrana,
// koja adresa sme da se otvori, koji argumenti komandne linije se prihvataju i
// kada se racunar zakljucava jer server cuti. Sve je cist racun nad ulazom -
// nema prozora, nema mreze, nema sata iz sistema "na tvrdo" - pa se proverava
// do kraja bez Windows-a i bez Electron-a (testovi/test-kiosk-zastita.mjs).
// main.js samo primenjuje odluke.

const path = require("node:path");
const { fileURLToPath } = require("node:url");

// ---------- TASTATURA U PROZORU LAUNCHERA ----------
//
// Globalne precice (Win+D, Ctrl+Shift+Esc...) guta main.js preko
// globalShortcut. Ovo su precice koje stizu DO PROZORA launchera i koje bi
// Chromium/Electron sam obradio: osvezavanje (izgubi se stanje ekrana),
// razvojni alati, zum, stampanje, zatvaranje, sistemski meni prozora.
//
// Kucanje mora da radi: slova, brojevi, Enter, Backspace, strelice, Tab, i
// Ctrl+A/C/V/X/Z/Y u poljima (lozinka, PIN, poruka). Zato se ne blokira "sve sa
// Ctrl", nego tacno spisak.
const CTRL_ZABRANJENO = new Set([
  "r",   // osvezi
  "w",   // zatvori karticu/prozor
  "q",   // izadji
  "n",   // nov prozor
  "t",   // nova kartica
  "o",   // otvori fajl
  "s",   // sacuvaj stranu
  "p",   // stampaj (otvara sistemski dijalog sa izborom fajla)
  "u",   // izvorni kod
  "f",   // pretraga u strani
  "g",   // sledeci pogodak pretrage
  "h",   // istorija
  "j",   // preuzimanja
  "l",   // adresna traka
  "e",   // pretraga
  "k",   // pretraga
  "d",   // obelezivac
  "+", "=", "-", "_", "0", // zum
]);
const CTRL_SHIFT_ZABRANJENO = new Set(["i", "j", "c", "k", "m", "r", "n", "t", "w", "q", "delete", "o", "b"]);
const F_ZABRANJENO = new Set(["f1", "f3", "f5", "f6", "f7", "f10", "f11", "f12"]);

// Vraca true ako taster NE SME da stigne do launchera. `input` je oblik koji
// Electron daje u "before-input-event" (key, code, control, alt, shift, meta).
function opasanTaster(input) {
  if (!input || (input.type && input.type !== "keyDown" && input.type !== "rawKeyDown")) return false;
  const key = String(input.key || "").toLowerCase();
  const code = String(input.code || "").toLowerCase();
  const ctrl = !!(input.control || input.meta);
  if (F_ZABRANJENO.has(key)) return true;
  // Alt+F4 (zatvori prozor), Alt+Space (sistemski meni prozora), sam Alt (meni)
  if (input.alt && (key === "f4" || key === " " || code === "space")) return true;
  if (ctrl && input.shift && CTRL_SHIFT_ZABRANJENO.has(key)) return true;
  if (ctrl && !input.alt && CTRL_ZABRANJENO.has(key)) return true;
  // Zum preko numerickog dela tastature
  if (ctrl && (code === "numpadadd" || code === "numpadsubtract" || code === "numpad0")) return true;
  // Navigacija unazad/unapred (tasteri na misu i Alt+strelice)
  if (input.alt && (key === "arrowleft" || key === "arrowright" || key === "home")) return true;
  if (key === "browserback" || key === "browserforward" || key === "browserrefresh" || key === "browserhome") return true;
  return false;
}

// ---------- ADRESE ----------
//
// Ekran launchera sme da otvori pregledac samo na pravoj internet adresi.
// shell.openExternal sa "file:///C:/Windows/System32/cmd.exe" bi pokrenuo
// komandnu liniju; "ms-settings:" bi otvorio Windows podesavanja.
function bezbednaAdresa(url) {
  const s = String(url ?? "").trim();
  if (s.length > 2000) return false;
  let u;
  try { u = new URL(s); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!u.hostname) return false;
  if (u.username || u.password) return false;
  return true;
}

// Prozor launchera sme da prikazuje samo svoje strane iz renderer foldera.
// Svaka druga navigacija (link, preusmerenje, ubacena skripta) se odbija.
function lokalnaStrana(url, rendererDir, platforma = process.platform) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== "file:" || u.host) return false;
  let put;
  try { put = path.resolve(fileURLToPath(u)); } catch { return false; }
  const koren = path.resolve(rendererDir) + path.sep;
  // Windows ne razlikuje velika i mala slova u putanji.
  return platforma === "win32" ? put.toLowerCase().startsWith(koren.toLowerCase()) : put.startsWith(koren);
}

// ---------- KOMANDNA LINIJA ----------
//
// Precica za autostart stoji u folderu igraca i on je moze izmeniti. Argument
// kao --remote-debugging-port otvara razvojne alate SPOLJA (pregledac na
// 127.0.0.1:9222 i launcher je u njegovim rukama), --inspect isto za glavni
// proces, a --dev i --no-lock gase kiosk. U INSTALIRANOM launcheru nista od toga
// ne sme da vazi.
//
// Dele se na dve vrste: one koje ce main.js samo da ne poslusa (--dev,
// --no-lock), i one koje je Chromium vec procitao pre prvog reda nase skripte
// (razvojni alati, sandbox, proksi...) - za njih launcher mora da se pokrene
// ponovo, bez njih.
// Chromium na Windows-u prihvata prekidac sa "--", "-" i "/" ispred.
const OPASNI_ARGUMENTI = /^(--|-|\/)(remote-debugging-port|remote-debugging-pipe|remote-debugging-address|remote-allow-origins|inspect|inspect-brk|inspect-port|debug|debug-brk|dev|no-lock|js-flags|user-data-dir|disable-web-security|no-sandbox|disable-site-isolation-trials|allow-file-access-from-files|ignore-certificate-errors|proxy-server|proxy-pac-url|host-rules|host-resolver-rules|load-extension|disable-features|enable-features|enable-blink-features)(=|$)/i;
const SAMO_ZANEMARI = /^(--|-|\/)(dev|no-lock)$/i;
function opasniArgumenti(argv) {
  return (argv || []).filter((a) => OPASNI_ARGUMENTI.test(String(a)));
}
// Da li zbog nekog argumenta launcher mora da se pokrene ponovo, cist.
function trebaPonovo(argv) {
  return opasniArgumenti(argv).some((a) => !SAMO_ZANEMARI.test(String(a)));
}

// ---------- NADZOR VEZE ----------
//
// Ugovor sa serverom (server/src/hub.js): server pinguje na 5 s i gasi vezu sa
// koje 15 s nije stiglo nista. Launcher radi isto u drugom smeru: ako 15 s ne
// cuje server (ni ping, ni poruku), veza se smatra mrtvom - i to i kad je TCP
// veza naizgled otvorena (iscupan kabl, zamrznut ruter).
//
// Tada se racunar ZAKLJUCAVA: launcher izlazi ispred svega i drzi ekran. Dok
// nema veze, server ne naplacuje vreme - bez zakljucavanja bi igrac mogao da
// iscupa kabl i igra dzabe igru koja ne trazi mrezu.
//
// Zakljucavanje ide u dva koraka, da zagrcnuta mreza ne kosta igraca igru:
//   1. posle 15 s tisine: ekran launchera preko igre (igra i dalje radi ispod)
//   2. posle `ugasiIgrePosleMs` (podrazumevano 2 min): igre i pregledaci se
//      gase - racunar ne sme da radi nenaplaceno
// Kad se veza vrati, server javi stanje (nastavak sesije ili prijava), i
// zakljucavanje se skida.
const TISINA_MS = 15000;
const UGASI_IGRE_POSLE_MS = 2 * 60000;

function napraviNadzorVeze({ tisinaMs = TISINA_MS, ugasiIgrePosleMs = UGASI_IGRE_POSLE_MS, sat = Date.now } = {}) {
  let poslednjiZnak = sat();
  let zakljucanoOd = 0;   // 0 = nije zakljucano
  let igreUgasene = false;
  return {
    // Bilo kakav znak od servera: otvorena veza, poruka, ping.
    znak() {
      poslednjiZnak = sat();
    },
    // Stanje se racuna na svaki otkucaj (1 s). Vraca sta main.js treba da uradi.
    //   prekiniVezu  veza je otvorena a server cuti - ugasi je (reconnect sledi)
    //   zakljucaj    upravo prelazimo u zakljucano stanje
    //   ugasiIgre    zakljucano je dovoljno dugo - ugasi igre (jednom)
    //   otkljucaj    server se javio posle zakljucavanja
    korak({ vezaOtvorena = false, podeseno = true } = {}) {
      const sada = sat();
      const tisina = sada - poslednjiZnak;
      const r = { tisina, zakljucano: !!zakljucanoOd, prekiniVezu: false, zakljucaj: false, ugasiIgre: false, otkljucaj: false };
      if (!podeseno) {
        // Launcher bez adrese servera (ekran za podesavanje) - nema sta da se ceka.
        if (zakljucanoOd) { zakljucanoOd = 0; igreUgasene = false; r.otkljucaj = true; r.zakljucano = false; }
        poslednjiZnak = sada;
        return r;
      }
      if (tisina > tisinaMs) {
        if (vezaOtvorena) r.prekiniVezu = true;
        if (!zakljucanoOd) { zakljucanoOd = sada; r.zakljucaj = true; }
        r.zakljucano = true;
        if (!igreUgasene && sada - zakljucanoOd >= ugasiIgrePosleMs) { igreUgasene = true; r.ugasiIgre = true; }
      } else if (zakljucanoOd) {
        zakljucanoOd = 0;
        igreUgasene = false;
        r.otkljucaj = true;
        r.zakljucano = false;
      }
      return r;
    },
    stanje() {
      return { poslednjiZnak, zakljucanoOd, igreUgasene, zakljucano: !!zakljucanoOd };
    },
  };
}

// ---------- PAD IGRE ----------
//
// Kad se igra srusi, Windows je zavrsi kodom greske (NTSTATUS): 0xC0000005
// pristup memoriji, 0xC0000409 prepisan stek, 0xE0434352 .NET izuzetak... - svi
// imaju najvisi bit upaljen (>= 0x80000000). Node ih daje kao neoznacen broj
// (3221225477), a ponekad i kao negativan - zato >>> 0.
//
// Sve ostalo NIJE pad: pokretac igre (Steam, Riot...) izadje sa 0 ili 1 u
// sekundi a igra nastavi pod drugim imenom, a igra ugasena iz Task Manager-a
// ili sa panela izlazi sa 1. Tu launcher ne sme da iskoci preko igre koja se
// tek otvara - o povratku odlucuje zastor (vidi main.js).
//   "pad"   srusila se: launcher se vraca u pun kiosk
//   null    obican izlaz
function vrstaIzlaza({ kod, signal } = {}) {
  if (signal) return "pad";
  const n = Number(kod);
  if (kod == null || !Number.isFinite(n) || n === 0) return null;
  return (n >>> 0) >= 0x80000000 ? "pad" : null;
}

module.exports = {
  opasanTaster, bezbednaAdresa, lokalnaStrana, opasniArgumenti, trebaPonovo, OPASNI_ARGUMENTI,
  napraviNadzorVeze, TISINA_MS, UGASI_IGRE_POSLE_MS, vrstaIzlaza,
};
