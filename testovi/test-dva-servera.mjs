// SERVER POKRENUT DVAPUT
//
// Autostart digne server, pa ga neko pokrene jos jednom rukom. Drugi primerak ne
// moze da zauzme port - i ranije je posle toga NASTAVLJAO da radi, bez porta, ali
// sa svim tajmerima (odrzavanje, kopije, rezervacije) nad istom bazom kao pravi
// server. A start-server.bat bi ga na svake 3 sekunde pokretao iznova, i svaki
// put je pravio novu rezervnu kopiju.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, brojac, citajIzvor } from "./_okruzenje.mjs";

const { proveri, kraj } = brojac();
const PORT = 8219;
const DATA = radniFolder("dva-servera-data");
const env = { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const skripta = path.join(KOREN, "server", "src", "index.js");

const prvi = spawn(process.execPath, [skripta], { env, stdio: "ignore" });
let ziv = false;
for (let i = 0; i < 60 && !ziv; i++) {
  try { ziv = !!(await fetch(`http://127.0.0.1:${PORT}/api/login`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status; } catch {}
  if (!ziv) await cekaj(200);
}
proveri("prvi server radi", ziv);
const kopijePre = fs.readdirSync(path.join(DATA, "backups")).length;

const drugi = spawn(process.execPath, [skripta], { env, stdio: ["ignore", "pipe", "pipe"] });
let izlaz = "";
drugi.stdout.on("data", (d) => { izlaz += d; });
drugi.stderr.on("data", (d) => { izlaz += d; });
const kod = await Promise.race([
  new Promise((r) => drugi.on("exit", (c) => r(c))),
  cekaj(10000).then(() => "i dalje radi"),
]);
proveri("drugi primerak se gasi sam", kod === 3, `izlazni kod: ${kod}`);
proveri("i kaže zašto", /ZAUZET/.test(izlaz), izlaz.slice(-200));
const kopijePosle = fs.readdirSync(path.join(DATA, "backups")).length;
proveri("drugi primerak NE pravi rezervnu kopiju", kopijePosle === kopijePre, `${kopijePre} -> ${kopijePosle}`);

let prviJos = false;
try { prviJos = !!(await fetch(`http://127.0.0.1:${PORT}/api/login`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status; } catch {}
proveri("prvi server i dalje radi", prviJos);

const bat = citajIzvor("server/start-server.bat");
proveri("start-server.bat prepoznaje zauzet port", /if errorlevel 3 if not errorlevel 4 goto zauzet/.test(bat));
proveri("i tada ne vrti restart na 3 sekunde", /:zauzet[\s\S]*timeout \/t 30/.test(bat));

try { drugi.kill(); } catch {}
try { prvi.kill(); } catch {}
await kraj();
