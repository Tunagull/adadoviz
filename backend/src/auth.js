require("dotenv").config();
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const isProduction = process.env.NODE_ENV === "production";

let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (isProduction) {
    // Prod'da zayıf/varsayılan secret ile açılmasına asla izin verme.
    throw new Error(
      "[Auth] JWT_SECRET tanımlı değil. Production ortamında güçlü bir JWT_SECRET zorunludur (bkz. backend/.env.example)."
    );
  }
  // Yalnızca local geliştirme: her process başlangıcında rastgele üret (öngörülemez,
  // ama restart'ta değişir — bu yüzden dev dışında asla kullanılmamalı).
  JWT_SECRET = crypto.randomBytes(48).toString("hex");
  console.warn(
    "[Auth] UYARI: JWT_SECRET env değişkeni tanımlı değil. Geliştirme için geçici, rastgele bir secret üretildi. " +
      "Kalıcı bir secret için backend/.env dosyasına JWT_SECRET ekleyin."
  );
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
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
    req.user = {
      username: decoded.username,
      institution_id: decoded.institution_id,
      institution_name: decoded.institution_name,
      role: decoded.role || "business",
    };
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

module.exports = {
  signToken,
  verifyToken,
  requireAuth,
  requireSuperAdmin,
  JWT_SECRET,
};
