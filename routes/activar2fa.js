import express from "express";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import db from "../models/db.js";

const router = express.Router();

// Middleware: usuario debe estar logueado
function requiereLogin(req, res, next) {
  if (!req.session.usuario) return res.redirect("/login");
  next();
}

// ========================================
// MOSTRAR QR y activar 2FA (para todos)
// ========================================
router.get("/", requiereLogin, async (req, res) => {
  const usuario = req.session.usuario;

  // Si ya tiene 2FA → redirigir al panel correspondiente
  if (usuario.twofa_enabled === 1) {
    if (usuario.rol.toLowerCase().includes("admin")) return res.redirect("/admin");
    if (usuario.rol.toLowerCase().includes("tecnico")) return res.redirect("/tecnico");
    return res.redirect("/");
  }

  // Generar nuevo secreto
  const secret = speakeasy.generateSecret({
    name: "Soporte TI EPN",
    length: 20,
  });

  // QR para Google Authenticator
  const qr = await QRCode.toDataURL(secret.otpauth_url);

  res.render("activar_2fa", {
    secret: secret.base32,
    qr,
    usuarioSesion: usuario,
    error: null,
  });
});

// ========================================
// PROCESAR ACTIVACIÓN DE 2FA
// ========================================
router.post("/", requiereLogin, async (req, res) => {
  const usuario = req.session.usuario;
  const { secret, token } = req.body;

  // Validar código ingresado
  const verified = speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });

  if (!verified) {
    return res.render("activar_2fa_general", {
      secret,
      qr: null,
      usuarioSesion: usuario,
      error: "Código incorrecto. Intenta de nuevo.",
    });
  }

  // Guardar en BD
  await db.query(
    "UPDATE usuarios SET twofa_secret = ?, twofa_enabled = 1 WHERE id = ?",
    [secret, usuario.id]
  );

  // Actualizar sesión
  req.session.usuario.twofa_enabled = 1;

  // Redirección según rol
  if (usuario.rol.toLowerCase().includes("admin")) return res.redirect("/admin");
  if (usuario.rol.toLowerCase().includes("tecnico")) return res.redirect("/tecnico");

  return res.redirect("/");
});

export default router;
