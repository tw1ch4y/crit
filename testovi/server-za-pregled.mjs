// Server na odvojenim podacima, za pregled panela (pregled-panela.mjs) i za
// gledanje uzivo u pregledacu. Ne dira server/data.
//
// Baza se puni kao prava igraonica: 13 racunara, pun sank, nekoliko igraca sa
// kreditom i otvorena smena. Na praznoj bazi se meri prazno stanje umesto
// pravog rasporeda, pa se odsecen tekst i pretrpani redovi nikad ne vide.
//
//   node server-za-pregled.mjs           port 8096
//   PORT=9000 node server-za-pregled.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.CRIT_DATA_DIR = path.join(KOREN, "testovi", ".radno", "pregled-data");
process.env.PORT = process.env.PORT || "8096";
await import(pathToFileURL(path.join(KOREN, "server", "src", "index.js")).href);

const BASE = `http://127.0.0.1:${process.env.PORT}`;
await new Promise((r) => setTimeout(r, 900));
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()).catch(() => null);

// Svaki deo se puni zasebno. Ranije je sve zavisilo od jednog uslova "ima li
// racunara", pa je prolaz koji je napravio racunare a pukao na igracima
// ostavljao bazu zauvek pola prazna - a sledeci put se preskakalo sve.
if (!(await api("/api/computers"))?.length) {
  await api("/api/computers/bulk", "POST", { count: 13, prefix: "PC-" });
}
if (!(await api("/api/shop"))?.length) {
  for (const [ime, cena, kat] of [
    ["Coca-Cola 0.33", 150, "Sokovi"], ["Fanta 0.33", 150, "Sokovi"], ["Sprite 0.33", 150, "Sokovi"],
    ["Voda 0.5", 100, "Sokovi"], ["Red Bull", 300, "Energetska"], ["Guarana", 220, "Energetska"],
    ["Espreso", 120, "Topli napici"], ["Kapućino", 180, "Topli napici"], ["Topla čokolada", 200, "Topli napici"],
    ["Čips paprika", 180, "Grickalice"], ["Smoki", 120, "Grickalice"], ["Štapići", 100, "Grickalice"],
    ["Sendvič", 350, "Hrana"], ["Burek", 250, "Hrana"],
  ]) await api("/api/shop", "POST", { name: ime, price: cena, category: kat, stock: 25 });
}
// Bez igara pocetna pokazuje prazno stanje, pa se pravi raspored nikad ne vidi.
if (!(await api("/api/games"))?.length) {
  for (const [ime, kat] of [
    ["Counter-Strike 2", "Pucačine"], ["Valorant", "Pucačine"], ["Call of Duty", "Pucačine"],
    ["Fortnite", "Battle Royale"], ["Apex Legends", "Battle Royale"], ["PUBG", "Battle Royale"],
    ["League of Legends", "MOBA"], ["Dota 2", "MOBA"],
    ["FIFA 24", "Sport"], ["Rocket League", "Sport"],
  ]) await api("/api/games", "POST", { name: ime, path: "C:\\games\\" + ime.toLowerCase().replace(/\s/g, "") + ".exe", category: kat });
}
if (!(await api("/api/players"))?.length) {
  for (const [u, ime] of [["marko", "Marko"], ["nikola", "Nikola"], ["stefan", "Stefan"], ["ana", "Ana"]]) {
    await api("/api/players", "POST", { username: u, password: u + "1234", displayName: ime });
  }
  for (const p of await api("/api/players")) await api(`/api/players/${p.id}/topup`, "POST", { amount: 1500, note: "keš" });
}
console.log("Panel spreman: " + BASE);
