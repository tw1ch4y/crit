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
  // "a.active = 1" je ovde, a ne samo pri prijavi: kad se radniku ugasi nalog,
  // token koji vec ima u pregledacu mora da prestane da radi ODMAH. Inace bi
  // otpusten radnik nastavio da dopunjuje kredit dok mu token ne istekne.
  const row = db
    .prepare("SELECT t.admin_id, t.created_at, a.username, a.role FROM admin_tokens t JOIN admins a ON a.id = t.admin_id WHERE t.token = ? AND a.active = 1")
    .get(String(token));
  if (!row || row.created_at < Date.now() - TOKEN_TTL) return null;
  return { adminId: row.admin_id, username: row.username, role: row.role };
}
export function revokeAdminToken(token) {
  db.prepare("DELETE FROM admin_tokens WHERE token = ?").run(String(token));
}

// Tokeni igrača su UKLONJENI, nisu zaboravljeni.
//
// Postojale su `issuePlayerToken` / `getPlayer` / `revokePlayerToken` koje niko
// nikad nije pozvao. Neupotrebljen kod u fajlu koji čuva prijavu je opasan na
// svoj način: pri sledećem čitanju liči na deo zaštite koji radi, pa se na
// njega računa. Igrač se prijavljuje isključivo kroz WebSocket launchera
// (`clientLogin`), gde sesiju drži veza samog računara - token mu ne treba.
//
// Kad igrač bude gledao svoj kredit sa telefona, token će mu trebati - ali onda
// mora da ide U BAZU, kao `admin_tokens` gore. Onaj stari je stajao u memoriji
// procesa, pa bi svaki restart servera izbacio sve prijavljene: ista greška
// koja je za panel već jednom ispravljena.

// ---- Express middleware ----
export function requireAdmin(req, res, next) {
  const token = tokenFromReq(req);
  const admin = getAdmin(token);
  if (!admin) return res.status(401).json({ error: "Neautorizovano" });
  req.admin = admin;
  next();
}

export function requireOwner(req, res, next) {
  const token = tokenFromReq(req);
  const admin = getAdmin(token);
  if (!admin) return res.status(401).json({ error: "Neautorizovano" });
  if (admin.role !== "owner") return res.status(403).json({ error: "Samo vlasnik ima pristup ovoj opciji" });
  req.admin = admin;
  next();
}

export function tokenFromReq(req) {
  const h = req.headers["authorization"];
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return req.query.token || null;
}
