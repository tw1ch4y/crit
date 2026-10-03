// Jedan "radnik" u testu paralelne kupovine (test-paralelna-kupovina.mjs).
//
// Radi u svojoj niti (worker_threads), sa SVOJOM vezom ka istoj bazi koju
// koristi i podignut server - kao drugi proces nad istom bazom. Tako se
// proverava izolacija same baze, a ne samo to da je Node jednonitan.
//
// Svi radnici cekaju na istoj barijeri i krecu u istom trenutku.
import { workerData, parentPort } from "node:worker_threads";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { koren, nacin, barijera, broj, redni, playerId, artikal, cena, pauzaMs = 40 } = workerData;
const uvezi = (f) => import(pathToFileURL(path.join(koren, "server", "src", f)).href);
const { db, uJednomPoslu } = await uvezi("db.js");
const knjiga = await uvezi("knjiga.js");
const svc = nacin === "kasa" ? await uvezi("service.js") : null;

const a = new Int32Array(barijera);
const spavaj = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Barijera: svako javi da je spreman, pa svi cekaju dok se ne skupe svi.
const barijeraNa = (mesto) => {
  Atomics.add(a, mesto, 1);
  while (Atomics.load(a, mesto) < broj) spavaj(1);
};
const stanje = () => db.prepare("SELECT balance FROM players WHERE id=?").get(playerId).balance;

let rez;
let video = null; // stanje koje je radnik video pre kupovine
try {
  if (nacin === "kasa") {
    // Prava putanja iz panela: racun na kasi, placanje kreditom.
    barijeraNa(0);
    const r = svc.createPosOrder({ items: [{ id: artikal, qty: 1 }], playerId, payment: "credit", actor: `radnik-${redni}` });
    rez = r.ok ? { ok: true, orderId: r.orderId } : { ok: false, greska: r.error };
  } else if (nacin === "zastareo") {
    // Najgori slucaj: SVI procitaju stanje pre nego sto iko krene (i svi vide
    // dovoljno), a posao drzi bravu jos pauzaMs - poslovi se preklapaju u vremenu.
    video = stanje();
    barijeraNa(0);
    uJednomPoslu(() => {
      knjiga.promeniKredit({ playerId, iznos: -cena, tip: "kupovina_artikla", operator: knjiga.radnik(null, `radnik-${redni}`),
        referenca: `proba:${redni}`, opis: "Paralelna kupovina" });
      spavaj(pauzaMs);
    });
    rez = { ok: true, video };
  } else if (nacin === "naivno") {
    // KONTROLA: obrazac koji je stajao u kodu pre knjige. Stanje procitano van
    // posla, obican BEGIN, apsolutan upis. Ovde se ocekuje da PROPADNE.
    video = stanje();
    barijeraNa(0);
    db.exec("BEGIN");
    try {
      spavaj(pauzaMs);
      if (video < cena) throw new Error(`Nedovoljno kredita (potrebno ${cena}, ima ${video})`);
      db.prepare("UPDATE players SET balance=? WHERE id=?").run(Math.round((video - cena) * 100) / 100, playerId);
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
    rez = { ok: true, video };
  } else if (nacin === "vreme") {
    // Naplata vremena za isti nalog, u istom trenutku kad i racun na kasi.
    barijeraNa(0);
    const k = uJednomPoslu(() => knjiga.naplatiVreme({ playerId, sessionId: 0, trazeno: cena }));
    rez = { ok: true, naplaceno: k?.naplaceno ?? 0 };
  } else {
    rez = { ok: false, greska: `nepoznat nacin ${nacin}` };
  }
} catch (e) {
  rez = { ok: false, greska: e.message, kod: e.kod || null };
}
parentPort.postMessage({ redni, nacin, video, ...rez });
