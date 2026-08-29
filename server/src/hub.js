import { WebSocketServer } from "ws";

// Transport sloj. Ne zna poslovnu logiku - samo prenosi poruke.
// index.js povezuje handlere sa servisom.

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

// KOLIKO SE CEKA DA SE VIDI DA RACUNARA NEMA
//
// Kad se racunaru prekine mreza nasilno - iscupan kabl, zamrznut Windows, ruter
// se resetovao - TCP veza ne umire odmah. Ostaje otvorena i po nekoliko sati,
// jer nijedna strana nema sta da posalje pa niko ne primeti da druge nema.
//
// Za igraonicu je to skupo dvaput: panel pokazuje racunar kao ZAUZET pa radnik
// tamo ne posadi nikoga, a naplata tece dalje jer se oslanja na to da server
// zna da racunara nema. Naplata JESTE napisana da se pauzira kad racunar padne,
// ali se ta zastita nikad nije ni aktivirala - server nije imao kako da sazna.
//
// Zato server pinguje svaku vezu. Ko ne odgovori do sledeceg ping-a, gasi se.
// 15 sekundi znaci da se gubitak vidi za najvise 30, pa igrac plati najvise
// pola minuta vremena koje nije proveo. Krace bi trosilo mrezu bez potrebe,
// duze bi se videlo na racunu.
const PING_MS = 15000;

export function initWs(server, { authComputer, authAdmin }) {
  const wss = new WebSocketServer({ server, path: "/ws" });

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
      // Verzija launchera dolazi uz adresu. Stariji launcheri je ne salju, pa
      // ostaje prazna - i to je podatak: znaci da je racunar zaostao.
      const verzija = (url.searchParams.get("v") || "").slice(0, 20);
      handlers.onClientOpen(comp, ws, ip, verzija);

      ws.on("message", (buf) => {
        let msg;
        // JSON.parse("null") ne baca gresku nego vrati null, a "[]" vrati niz -
        // bez ove provere bi jedna takva poruka srusila ceo server.
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

// Zatvara panel koji je vec otvoren kod odredjenog naloga.
//
// Token se proverava pri POVEZIVANJU. Kad se radniku oduzme pristup, njegov
// panel je i dalje otvoren i nastavlja da prima promet uzivo dok ne osvezi
// stranu. Nista ne moze da uradi - svaki zahtev se proverava iznova - ali ni to
// ne treba da gleda.
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
