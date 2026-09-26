import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { db } from "./db.js";

// ---- Lozinke (scrypt, bez spoljnih zavisnosti) ----
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const salt = Buffer.from(saltHex, "hex");
    const hash = Buffer.from(hashHex, "hex");
    const test = scryptSync(String(pw), salt, hash.length);
    return timingSafeEqual(hash, test);
  } catch {
    return false;
  }
}

// ---- Admin tokeni u bazi: prijava na panel prezivljava restart servera ----
const TOKEN_TTL = 30 * 24 * 3600 * 1000; // 30 dana

export function issueAdminToken(admin) {
  const token = randomUUID();
  db.prepare("DELETE FROM admin_tokens WHERE created_at < ?").run(Date.now() - TOKEN_TTL);
  db.prepare("INSERT INTO admin_tokens (token, admin_id, created_at) VALUES (?,?,?)").run(token, admin.id, Date.now());
  return token;
}
export function getAdmin(token) {
  if (!token) return null;
  // `a.active = 1` i ovde, da token radnika kome je oduzet pristup odmah
  // prestane da važi.
  const row = db
    .prepare("SELECT t.admin_id, t.created_at, a.username, a.role FROM admin_tokens t JOIN admins a ON a.id = t.admin_id WHERE t.token = ? AND a.active = 1")
    .get(String(token));
  if (!row || row.created_at < Date.now() - TOKEN_TTL) return null;
  return { adminId: row.admin_id, username: row.username, role: row.role };
}
export function revokeAdminToken(token) {
  db.prepare("DELETE FROM admin_tokens WHERE token = ?").run(String(token));
}

// Igrač se prijavljuje samo kroz WebSocket launchera (clientLogin), pa
// tokeni igrača ne postoje. Ako zatrebaju (npr. pregled kredita sa
// telefona), idu u bazu, kao admin_tokens.

// ---- Express middleware ----
export function requireAdmin(req, res, next) {
  const token = tokenFromReq(req);
  const admin = getAdmin(token);
  if (!admin) return res.status(401).json({ error: "Neautorizovano" });
  req.admin = admin;
  next();
}

// ---- Uloge ----
//
// Radnik < vlasnik < serviser; viša uloga sme sve što sme niža.
//
//   radnik    kontrolna tabla, igrači, porudžbine, kasa
//   vlasnik   sve u igraonici: cene, podešavanja, katalog, radnici
//   serviser  održavanje programa i nadogradnje
//
// Vlasnik ne dodaje i ne uklanja servisere, pa podrška može da uđe i kad se
// vlasnik zaključa. Serviserski nalog se vidi na strani Radnici.
export const RANG = { staff: 1, owner: 2, serviser: 3 };
export const rang = (uloga) => RANG[uloga] || 0;
export const jeServiser = (a) => rang(a?.role) >= RANG.serviser;

function traziRang(potreban, poruka) {
  return (req, res, next) => {
    const admin = getAdmin(tokenFromReq(req));
    if (!admin) return res.status(401).json({ error: "Neautorizovano" });
    if (rang(admin.role) < potreban) return res.status(403).json({ error: poruka });
    req.admin = admin;
    next();
  };
}

// Vlasnik I serviser - serviser sme sve što sme vlasnik.
export const requireOwner = traziRang(RANG.owner, "Samo vlasnik ima pristup ovoj opciji");
// Samo serviser.
export const requireServiser = traziRang(RANG.serviser, "Samo serviser ima pristup ovoj opciji");

export function tokenFromReq(req) {
  const h = req.headers["authorization"];
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return req.query.token || null;
}
