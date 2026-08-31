require("dotenv").config();
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { findAdminByUsername } = require("./db");

const isProduction = process.env.NODE_ENV === "production";

let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (isProduction) {
    throw new Error(
      "[Auth] JWT_SECRET tanımlı değil. Production ortamında güçlü bir JWT_SECRET zorunludur (bkz. backend/.env.example)."
    );
  }
  JWT_SECRET = crypto.randomBytes(48).toString("hex");
  console.warn(
    "[Auth] UYARI: JWT_SECRET env değişkeni tanımlı değil. Geliştirme için geçici, rastgele bir secret üretildi. " +
      "Kalıcı bir secret için backend/.env dosyasına JWT_SECRET ekleyin."
  );
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
}

function mapUser(admin, decoded = {}) {
  return {
    username: admin?.username || decoded.username,
    institution_id: admin?.institution_id || decoded.institution_id,
    institution_name: admin?.institution_name || decoded.institution_name,
    role: admin?.role || decoded.role || "business",
    is_active: admin
      ? !(admin.is_active === 0 || admin.is_active === false)
      : true,
    id: admin?.id || null,
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Yetkilendirme gerekli." });
  }

  try {
    const decoded = verifyToken(token);
    if (!decoded?.institution_id && decoded?.role !== "superadmin") {
      return res.status(401).json({ error: "Geçersiz token." });
    }
    const admin = decoded?.username ? findAdminByUsername(decoded.username) : null;
    if (!admin) {
      return res.status(401).json({ error: "Oturum geçersiz veya süresi dolmuş." });
    }
    req.user = mapUser(admin, decoded);
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Oturum geçersiz veya süresi dolmuş." });
  }
}

function requireSuperAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user?.role !== "superadmin") {
      return res.status(403).json({ error: "Super admin yetkisi gerekli." });
    }
    return next();
  });
}

/**
 * Pasif işletme giriş yapabilir ve GET okuyabilir.
 * Kur / marj / şube yazmaları (POST/PUT/PATCH/DELETE) 403 döner.
 * Abonelik uzatma / şube talebi (branch-requests) serbesttir.
 */
function requireWritableBusiness(req, res, next) {
  if (req.user?.role === "superadmin") return next();
  if (!WRITE_METHODS.has(String(req.method || "").toUpperCase())) return next();
  if (req.user?.is_active !== false) return next();
  return res.status(403).json({
    error:
      "Hesabınız pasif. Kur, marj veya şube değişikliği yapılamaz. Abonelik uzatma veya yeni şube talebi gönderebilirsiniz.",
    code: "BUSINESS_INACTIVE",
  });
}

module.exports = {
  signToken,
  verifyToken,
  requireAuth,
  requireSuperAdmin,
  requireWritableBusiness,
  JWT_SECRET,
};
