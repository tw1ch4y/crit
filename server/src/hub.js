import { WebSocketServer } from "ws";
import { KocnicaVeze, strazaTokena } from "./brzina.js";
import { proveriKlijentskuPoruku } from "./seme.js";
import { zabelezi, NIVO } from "./bezbednost.js";

// Transport sloj. Ne zna poslovnu logiku - samo prenosi poruke.
// index.js povezuje handlere sa servisom.
//
// Ali ovde se odlucuje STA uopste sme da stigne do servisa: velicina poruke,
// brzina kojom racunar salje, i da li poruka odgovara protokolu (seme.js).
// Servis dobija samo poruke koje su prosle sve tri brane.

const panels = new Set(); // ws konekcije admin panela
const clients = new Map(); // computerId -> ws (Electron launcheri)
const meta = new WeakMap(); // ws -> { kind, computerId?, adminId?, veza? }

// NAJVECA PORUKA. ws podrazumevano prima do 100 MB u jednoj poruci - jedan
// racunar bi tako mogao da natera server da drzi stotine megabajta u memoriji.
// Najveca poruka koju pravi launcher salje je spisak procesa za panel
// (nekoliko stotina procesa, desetine KB). 512 KB je visestruko iznad toga.
export const NAJVECA_PORUKA = 512 * 1024;

// Svaka veza dobija svoj broj. Sesija igraca se vezuje za VEZU (vidi
// sesija.js), pa servis mora da razlikuje staru i novu vezu istog racunara.
let brojVeze = 0;

// IP klijenta sa socketa (skini IPv6 prefiks za LAN adrese)
const ocistiIp = (req) => String(req.socket.remoteAddress || "")
  .replace(/^::ffff:/, "")
  .replace(/^::1$/, "127.0.0.1");

// Parametri adrese su ulaz kao i svaki drugi: duzina je ogranicena, a
// nepostojeci se citaju kao prazni.
function parametar(url, ime, max) {
  const v = url.searchParams.get(ime);
  return v == null ? "" : String(v).slice(0, max);
}

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
// Zato server pinguje svaku vezu na PING_MS, a vezu sa koje 15 sekundi
// (TISINA_MS) nije stiglo NISTA - ni odgovor na ping, ni poruka - gasi.
//
// 15 s je ugovor sa launcherom: i on gasi vezu i zakljucava racunar kad 15 s
// ne cuje server (vidi client/main.js, nadzorVeze). Ping na 5 s znaci da jedan
// izgubljen ping (zagrcnuta mreza) jos nije prekid - tek tri zaredom jesu. Ping
// je par bajtova; trinaest racunara na 5 s je zanemarljivo za mrezu.
const PING_MS = 5000;
export const TISINA_MS = 15000;

export function initWs(server, { authComputer, authAdmin }) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: NAJVECA_PORUKA });

  // Monotoni sat: pomeranje sistemskog vremena ne sme da pogasi sve veze.
  let prosliOtkucaj = performance.now();
  const otkucaj = setInterval(() => {
    const sada = performance.now();
    // Server je stajao (spor disk, velika kopija baze, uspavan racunar): tisinu
    // je napravio on, ne racunari. Rok se svima pomera, niko se ne gasi.
    const stajao = sada - prosliOtkucaj > 3 * PING_MS;
    prosliOtkucaj = sada;
    for (const ws of wss.clients) {
      if (stajao) ws.poslednjiZnak = sada;
      else if (sada - (ws.poslednjiZnak || 0) > TISINA_MS) { try { ws.terminate(); } catch {} continue; }
      try { ws.ping(); } catch {}
    }
  }, PING_MS);
  wss.on("close", () => clearInterval(otkucaj));

  wss.on("connection", (ws, req) => {
    // Svaki znak sa druge strane (odgovor na ping, njen ping ili poruka) pomera rok.
    const ziv = () => { ws.poslednjiZnak = performance.now(); };
    ziv();
    ws.on("pong", ziv);
    ws.on("ping", ziv);
    ws.on("message", ziv);
    // Greska na uticnici (npr. poruka preko NAJVECA_PORUKA) ne sme da postane
    // neuhvacena greska procesa. ws posle nje sam zatvara vezu.
    ws.on("error", () => {});
    const url = new URL(req.url, "http://x");
    const kind = parametar(url, "kind", 10); // "client" | "panel"
    const token = parametar(url, "token", 200);
    const ip = ocistiIp(req);

    if (kind === "client") {
      // Adresa koja je upravo pogadjala tokene se ne pusti ni do baze.
      const blokirana = strazaTokena.blokirana(ip);
      if (blokirana) {
        zabelezi({ vrsta: "ip_blokiran_pokusaj", nivo: NIVO.upozorenje, ip,
          opis: `Adresa ${ip} je blokirana zbog pogadjanja tokena računara (još ${blokirana} s) i opet pokušava` });
        try { ws.send(JSON.stringify({ t: "error", message: "Previše neispravnih pokušaja. Sačekajte." })); } catch {}
        return ws.close(1008);
      }
      const comp = authComputer(token);
      if (!comp) {
        const s = strazaTokena.promasaj(ip);
        zabelezi({
          vrsta: s.upravo ? "ip_blokiran" : "token_racunara_neispravan",
          nivo: s.upravo ? NIVO.kriticno : NIVO.upozorenje,
          ip,
          opis: s.upravo
            ? `Adresa ${ip} je blokirana na ${Math.round(strazaTokena.trajanje / 60000)} min - ${s.promasaja} neispravnih tokena računara zaredom`
            : `Povezivanje sa neispravnim tokenom računara sa ${ip}`,
          podaci: { duzinaTokena: token.length, prazan: !token },
        });
        ws.send(JSON.stringify({ t: "error", message: "Nevažeći token računara" }));
        return ws.close();
      }
      // Verzija launchera dolazi uz adresu. Stariji launcheri je ne salju, pa
      // ostaje prazna - i to je podatak: znaci da je racunar zaostao.
      const verzija = parametar(url, "v", 20);
      const veza = {
        id: ++brojVeze,
        computerId: comp.id,
        racunar: comp.name,
        ip,
        verzija,
        // Protokol 2 = launcher koji ume da cuva i pokaze token sesije. Stariji
        // ne salju nista i vode se kao 1.
        protokol: parametar(url, "p", 3) === "2" ? 2 : 1,
        // Token sesije, ako launcher nastavlja vec zapocetu sesiju.
        sesija: parametar(url, "sesija", 200),
        kocnica: new KocnicaVeze(),
      };
      meta.set(ws, { kind: "client", computerId: comp.id, veza });
      // ako je vec bila konekcija za taj racunar, zatvori staru
      const old = clients.get(comp.id);
      if (old && old !== ws) try { old.close(); } catch {}
      clients.set(comp.id, ws);
      handlers.onClientOpen(comp, ws, ip, verzija, veza);

      ws.on("message", (buf) => {
        // 1. BRZINA, pre citanja. Citanje JSON-a je vec posao.
        const b = veza.kocnica.propustiSirovu();
        if (!b.ok) return odbijenoZbogBrzine(ws, veza, "sve", b.prekini);

        let msg;
        // JSON.parse("null") ne baca gresku nego vrati null, a "[]" vrati niz -
        // bez ove provere bi jedna takva poruka srusila ceo server.
        try { msg = JSON.parse(buf.toString()); } catch {
          zabelezi({ vrsta: "poruka_neispravna", nivo: NIVO.upozorenje, ip, racunar: comp.name, racunarId: comp.id,
            opis: `${comp.name} je poslao poruku koja nije JSON`, podaci: { bajtova: buf.length } });
          return;
        }
        // 2. BRZINA po tipu: skupe poruke imaju svoju granicu.
        const bt = veza.kocnica.propustiTip(msg?.t);
        if (!bt.ok) return odbijenoZbogBrzine(ws, veza, bt.razlog, bt.prekini);

        // 3. PROTOKOL: poruka mora da bude tacno ono sto nas launcher salje.
        const p = proveriKlijentskuPoruku(msg);
        if (!p.ok) {
          const tocak = p.tip === "tocak_spin";
          zabelezi({
            vrsta: tocak ? "tocak_nametanje_ishoda" : p.razlog === "nepoznata" ? "poruka_nepoznata" : "poruka_neispravna",
            nivo: tocak ? NIVO.kriticno : NIVO.upozorenje,
            ip, racunar: comp.name, racunarId: comp.id,
            kljuc: `poruka|${comp.id}|${p.tip}`,
            opis: tocak
              ? `${comp.name}: zahtev za točak sa poljima koja server ne prihvata - pokušaj da se nametne ishod`
              : p.razlog === "nepoznata"
                ? `${comp.name} je poslao nepoznatu poruku "${p.tip}"`
                : `${comp.name}: poruka "${p.tip}" ne odgovara protokolu (${p.greske.map((g) => g.polje).join(", ")})`,
            podaci: { tip: p.tip, razlog: p.razlog, greske: p.greske },
          });
          return;
        }
        if (p.odbacena.length) {
          zabelezi({ vrsta: "porudzbina_visak_polja", nivo: NIVO.upozorenje, ip, racunar: comp.name, racunarId: comp.id,
            opis: `${comp.name}: porudžbina sa poljima koja launcher ne šalje (${p.odbacena.join(", ")}) - cena je uzeta iz baze`,
            podaci: { polja: p.odbacena } });
        }
        // Jedna losa poruka sa jednog racunara ne sme da obori celu igraonicu.
        try { handlers.onClientMessage(comp.id, p.poruka, veza); }
        catch (e) { console.error(`poruka sa ${comp.name}:`, e.message); }
      });
      // Poruka preko NAJVECA_PORUKA: ws je odbije, prijavi gresku i sam zatvori
      // vezu kodom 1009.
      ws.on("error", (e) => {
        if (e?.code !== "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") return;
        zabelezi({ vrsta: "poruka_prevelika", nivo: NIVO.upozorenje, ip, racunar: comp.name, racunarId: comp.id,
          opis: `${comp.name} je poslao poruku veću od ${Math.round(NAJVECA_PORUKA / 1024)} KB - veza je prekinuta` });
      });
      ws.on("close", () => {
        if (clients.get(comp.id) === ws) clients.delete(comp.id);
        handlers.onClientClose(comp.id, veza);
      });
    } else if (kind === "panel") {
      // Panel se otvara u pregledacu. Pregledac salje Origin, i on mora da bude
      // ovaj server: tudja strana ne sme da otvori vezu sa tokenom koji je
      // nekako dobila.
      const origin = req.headers.origin;
      if (origin) {
        let isti = false;
        try { isti = new URL(origin).host === req.headers.host; } catch {}
        if (!isti) {
          zabelezi({ vrsta: "panel_tudji_izvor", nivo: NIVO.upozorenje, ip,
            opis: `Veza ka panelu sa tuđe strane (${String(origin).slice(0, 80)}) je odbijena` });
          ws.send(JSON.stringify({ t: "error", message: "Neautorizovano" }));
          return ws.close(1008);
        }
      }
      const admin = authAdmin(token);
      if (!admin) {
        // Istekao token (30 dana) je obican dogadjaj - vidi prijaviLosToken u auth.js.
        zabelezi({ vrsta: "token_panela_neispravan", nivo: NIVO.info, ip,
          opis: `Veza ka panelu sa neispravnim tokenom sa ${ip}` });
        ws.send(JSON.stringify({ t: "error", message: "Neautorizovano" }));
        return ws.close();
      }
      meta.set(ws, { kind: "panel", adminId: admin.adminId });
      panels.add(ws);
      handlers.onPanelOpen(ws);
      // Panel serveru ne salje nista. Ko kroz tu vezu salje, salje smece - a
      // ni to ne sme da bude bez granice.
      const kocnica = new KocnicaVeze();
      ws.on("message", () => {
        const b = kocnica.propustiSirovu();
        if (!b.ok && b.prekini) {
          zabelezi({ vrsta: "veza_prekinuta_spam", nivo: NIVO.kriticno, ip, opis: `Veza panela sa ${ip} zatrpava server - prekinuta` });
          try { ws.close(1008); } catch {}
        }
      });
      ws.on("close", () => panels.delete(ws));
    } else {
      ws.close();
    }
  });

  return wss;
}

// Racunar salje brze nego sto sme. Poruka se odbacuje; ako ne prestaje, veza se
// prekida (launcher se sam vraca za tri sekunde, skripta koja zatrpava - ne
// mora). U dnevnik ide jednom u minutu po racunaru, sa brojem ponavljanja.
function odbijenoZbogBrzine(ws, veza, razlog, prekini) {
  if (prekini) {
    zabelezi({ vrsta: "veza_prekinuta_spam", nivo: NIVO.kriticno, ip: veza.ip, racunar: veza.racunar, racunarId: veza.computerId,
      opis: `${veza.racunar} i posle odbijanja zatrpava server porukama - veza je prekinuta`,
      podaci: { odbijeno: veza.kocnica.ukupnoOdbijeno } });
    try { ws.close(1008, "Previse poruka"); } catch {}
    return;
  }
  zabelezi({ vrsta: "brzina_prekoracena", nivo: NIVO.upozorenje, ip: veza.ip, racunar: veza.racunar, racunarId: veza.computerId,
    opis: razlog === "sve"
      ? `${veza.racunar} šalje više poruka nego što launcher ikad šalje - višak se odbacuje`
      : `${veza.racunar} prečesto šalje "${razlog}" - višak se odbacuje`,
    podaci: { razlog } });
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
