import { WebSocketServer } from "ws";

// Transport: prenosi poruke, bez poslovne logike (handlere povezuje index.js).

const panels = new Set(); // ws konekcije admin panela
const clients = new Map(); // computerId -> ws (Electron launcheri)
const meta = new WeakMap(); // ws -> { kind, computerId?, adminId? }

let handlers = {
  onClientMessage: () => {},
  onClientOpen: () => {},
  onClientClose: () => {},
  onPanelOpen: () => {},
};

export function setHandlers(h) {
  handlers = { ...handlers, ...h };
}

// Server pinguje svaku vezu; veza koja ne odgovori do sledećeg pinga se
// gasi. TCP veza posle izvučenog kabla ili zamrznutog Windows-a inače ostaje
// otvorena satima, a naplata se pauzira tek kad server zna da računara nema.
// Sa 15 s gubitak se vidi za najviše 30 s.
const PING_MS = 15000;

// Najveća poruka od launchera je spisak procesa (desetine KB);
// podrazumevana granica biblioteke je 100 MB.
export const NAJVECA_PORUKA = 2 * 1024 * 1024;

export function initWs(server, { authComputer, authAdmin }) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: NAJVECA_PORUKA });
  // Greške http servera obrađuje index.js; bez slušaoca bi ih ws bacio kao
  // neuhvaćene.
  wss.on("error", () => {});

  const otkucaj = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.zivo === false) { try { ws.terminate(); } catch {} continue; }
      ws.zivo = false;
      try { ws.ping(); } catch {}
    }
  }, PING_MS);
  wss.on("close", () => clearInterval(otkucaj));

  wss.on("connection", (ws, req) => {
    // Sveza veza vazi kao ziva do prvog ping-a koji ostane bez odgovora.
    ws.zivo = true;
    ws.on("pong", () => { ws.zivo = true; });
    // Greška na jednoj vezi: biblioteka je zatvara sama.
    ws.on("error", () => {});
    const url = new URL(req.url, "http://x");
    const kind = url.searchParams.get("kind"); // "client" | "panel"
    const token = url.searchParams.get("token");

    if (kind === "client") {
      const comp = authComputer(token);
      if (!comp) {
        ws.send(JSON.stringify({ t: "error", message: "Nevažeći token računara" }));
        return ws.close();
      }
      // IP klijenta sa socketa (skini IPv6 prefiks za LAN adrese)
      const ip = String(req.socket.remoteAddress || "")
        .replace(/^::ffff:/, "")
        .replace(/^::1$/, "127.0.0.1");
      meta.set(ws, { kind: "client", computerId: comp.id });
      // ako je vec bila konekcija za taj racunar, zatvori staru
      const old = clients.get(comp.id);
      if (old && old !== ws) try { old.close(); } catch {}
      clients.set(comp.id, ws);
      // Verzija launchera iz adrese; stariji launcher je ne šalje.
      const verzija = (url.searchParams.get("v") || "").slice(0, 20);
      // offline=1: launcher je radio bez servera; sesija se vraća tek posle
      // izveštaja (clientOfflineIzvestaj). `n` je numeracija verzija (verzije.js),
      // 0 za staru.
      const numeracija = Math.min(99, Math.max(0, parseInt(url.searchParams.get("n"), 10) || 0));
      handlers.onClientOpen(comp, ws, ip, verzija, { offline: url.searchParams.get("offline") === "1", numeracija });

      ws.on("message", (buf) => {
        let msg;
        // JSON.parse("null") vraća null, a "[]" niz; prolazi samo objekat.
        try { msg = JSON.parse(buf.toString()); } catch { return; }
        if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
        // Jedna losa poruka sa jednog racunara ne sme da obori celu igraonicu.
        try { handlers.onClientMessage(comp.id, msg, ws); }
        catch (e) { console.error(`poruka sa ${comp.name}:`, e.message); }
      });
      ws.on("close", () => {
        if (clients.get(comp.id) === ws) clients.delete(comp.id);
        handlers.onClientClose(comp.id);
      });
    } else if (kind === "panel") {
      const admin = authAdmin(token);
      if (!admin) {
        ws.send(JSON.stringify({ t: "error", message: "Neautorizovano" }));
        return ws.close();
      }
      meta.set(ws, { kind: "panel", adminId: admin.adminId });
      panels.add(ws);
      handlers.onPanelOpen(ws);
      ws.on("close", () => panels.delete(ws));
    } else {
      ws.close();
    }
  });

  return wss;
}

// Zatvara otvoren panel naloga kome je oduzet pristup (token se proverava
// pri povezivanju).
export function izbaciPanel(adminId) {
  let izbaceno = 0;
  for (const ws of panels) {
    if (meta.get(ws)?.adminId !== adminId) continue;
    try { ws.send(JSON.stringify({ t: "error", message: "Pristup je oduzet" })); } catch {}
    try { ws.close(); } catch {}
    izbaceno++;
  }
  return izbaceno;
}

// Zatvara vezu uklonjenog računara.
export function izbaciRacunar(computerId) {
  const ws = clients.get(computerId);
  if (!ws) return false;
  clients.delete(computerId);
  try { ws.send(JSON.stringify({ t: "error", message: "Računar je uklonjen iz igraonice" })); } catch {}
  try { ws.close(); } catch {}
  return true;
}

export function broadcastPanels(obj) {
  const data = JSON.stringify(obj);
  for (const ws of panels) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

export function broadcastClients(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

export function sendClient(computerId, obj) {
  const ws = clients.get(computerId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

export function sendToWs(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

export function isClientOnline(computerId) {
  const ws = clients.get(computerId);
  return !!(ws && ws.readyState === ws.OPEN);
}
