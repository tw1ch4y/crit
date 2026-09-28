import { radniFolder, podigniServer, ucitajWebSocket, brojac, citajIzvor } from "./_okruzenje.mjs";
import { TEME } from "../server/src/nivoi.js";
const WebSocket = await ucitajWebSocket();
// TEME LAUNCHERA
//
// Vlasnik bira kucnu temu i da li se pozadina krece; igrac bira svoju medju
// otkljucanima. Ovde se proverava ono sto launcher ne moze sam da cuva:
// da server pusti samo poznatu temu, da promena stigne na racunare odmah, i
// da radnik ne moze da menja izgled cele igraonice.
const PORT = 8233;
const BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
await podigniServer(radniFolder("teme-data"), PORT);
const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const prijava = async (u, p) => (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: J({ username: u, password: p }) }).then((r) => r.json())).token;
const token = await prijava("admin", "admin");
const api = (p, m = "GET", b, t = token) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + t },
  body: b ? J(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const poc = await api("/api/izgled-kuce");
proveri("sveza igraonica ima kucnu temu i laganu pozadinu", poc.body?.tema === "kuca" && poc.body?.pokret === "lagano", J(poc.body));
proveri("panel dobija spisak svih tema sa paletom", poc.body?.teme?.length === Object.keys(TEME).length && poc.body.teme.every((t) => t.boje?.bg));
proveri("panel dobija i izbore pokreta", !!poc.body?.pokreti?.lagano && !!poc.body?.pokreti?.iskljuceno);

// Racunar na vezi - promena mora da stigne bez restarta.
const pc = (await api("/api/computers")).body[0];
const poruke = [];
const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}`);
w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
await cekaj(400);
const dobrodoslica = poruke.find((m) => m.t === "welcome");
proveri("launcher uz pozdrav dobija izgled i teme", dobrodoslica?.izgled?.tema === "kuca" && Array.isArray(dobrodoslica?.teme), J(Object.keys(dobrodoslica || {})));
proveri("u pozdravu vise nema starih sara", !("tekstura" in (dobrodoslica || {})) && !("teksture" in (dobrodoslica || {})));

poruke.length = 0;
const r = await api("/api/izgled-kuce", "POST", { tema: "zlato", pokret: "iskljuceno" });
await cekaj(300);
proveri("vlasnik menja kucnu temu", r.status === 200 && r.body?.tema === "zlato" && r.body?.pokret === "iskljuceno", J(r.body));
proveri("PROMENA STIZE NA RACUNARE ODMAH", poruke.some((m) => m.t === "izgled" && m.izgled?.tema === "zlato" && m.izgled?.pokret === "iskljuceno"),
  J(poruke.map((m) => m.t)));
proveri("promena je upisana u dnevnik", (await api("/api/logs?limit=20")).body?.some?.((l) => l.action === "izgled_kuce")
  ?? JSON.stringify((await api("/api/logs")).body).includes("izgled_kuce"));

// Nepoznato se odbija i nista se ne menja.
for (const [opis, telo] of [["nepoznata tema", { tema: "nema-je" }], ["ime iz prototipa", { tema: "constructor" }],
  ["tema kao niz", { tema: ["kuca"] }], ["nepoznat pokret", { pokret: "brzo" }], ["pokret iz prototipa", { pokret: "toString" }]]) {
  const x = await api("/api/izgled-kuce", "POST", telo);
  proveri(`odbija se: ${opis}`, x.status === 400, `${x.status} ${J(x.body)}`);
}
proveri("posle odbijenih zahteva izgled je isti", (await api("/api/izgled-kuce")).body?.tema === "zlato");

// Samo pola izmene: pokret se menja, tema ostaje.
await api("/api/izgled-kuce", "POST", { pokret: "lagano" });
const pola = (await api("/api/izgled-kuce")).body;
proveri("menja se samo ono sto je poslato", pola.tema === "zlato" && pola.pokret === "lagano", J(pola));

// Radnik ne menja izgled cele igraonice.
await api("/api/admins", "POST", { username: "radnik", password: "radnik1234", role: "staff" });
const tr = await prijava("radnik", "radnik1234");
const rad = await api("/api/izgled-kuce", "POST", { tema: "kuca" }, tr);
proveri("radnik ne moze da menja temu igraonice", rad.status === 403 || rad.status === 401, String(rad.status));

// Panel crta kartice tema iz istog spiska - bez upisanih boja u panelu.
const app = citajIzvor("server/public/js/app.js");
proveri("panel crta teme iz spiska sa servera", /\/izgled-kuce/.test(app) && /data-kucna-tema/.test(app));
proveri("panel vise ne zna za sare", !/\/tekstura|tex-kartica|tekstura_|data-tex/.test(app));

// <body> nosi data-tema i data-pokret. Klik koji trazi closest("[data-tema]")
// bi se popeo do body-ja i svaki klik u sadrzaju bio bi "izbor teme": korpa i
// pokretanje igara su tako stali (nadjeno na pravom launcheru, proba-porudzbine).
const rend = citajIzvor("client/renderer/js/launcher.js");
const naBody = [...new Set([...rend.matchAll(/\bb\.dataset\.(\w+)\s*=/g)].map((m) => m[1]))];
proveri("launcher postavlja temu na body", naBody.includes("tema") && naBody.includes("pokret"), J(naBody));
for (const ime of naBody) {
  const kebab = ime.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  proveri(`klik ne trazi goli [data-${kebab}] (uhvatio bi body)`, !rend.includes(`closest("[data-${kebab}]")`));
}

w.close();
await cekaj(200);
kraj();
