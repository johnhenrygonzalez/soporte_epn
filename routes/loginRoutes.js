import express from "express";
import { mostrarLogin, procesarLogin, cerrarSesion } from "../controllers/loginController.js";
import speakeasy from "speakeasy";
import db from "../models/db.js";

const router = express.Router();

// ==========================================
// LOGIN NORMAL
// ==========================================
router.get("/", mostrarLogin);
router.post("/", procesarLogin);

// ==========================================
// CERRAR SESIÓN
// ==========================================
router.post("/logout", cerrarSesion);

// ==========================================
// MOSTRAR FORMULARIO PARA INGRESAR CÓDIGO 2FA
// (RUTA REAL: /login/verificar-2fa porque en app.js se monta en "/login")
// ==========================================
router.get("/verificar-2fa", (req, res) => {
  // Si no existe usuario temporal NO permitir acceso
  if (!req.session.tempUser) {
    return res.redirect("/login");
  }

  res.render("verificar_2fa", {
    title: "Verificación 2FA",
    error: null,
  });
});

// ==========================================
// PROCESAR CÓDIGO 2FA
// (RUTA REAL: /login/verificar-2fa)
// ==========================================
router.post("/verificar-2fa", async (req, res) => {
  try {
    const { codigo } = req.body; // <- viene del input del formulario

    // Si no hay usuario temporal → no debe estar aquí
    if (!req.session.tempUser) {
      return res.redirect("/login");
    }

    const usuario = req.session.tempUser;

    // Validar código TOTP
    const verified = speakeasy.totp.verify({
      secret: usuario.twofa_secret,
      encoding: "base32",
      token: codigo,
      window: 1, // pequeña tolerancia
    });

    if (!verified) {
      return res.render("verificar_2fa", {
        title: "Verificación 2FA",
        error: "Código incorrecto. Intente nuevamente.",
      });
    }

    // ==================================
    // CÓDIGO CORRECTO → CREAR SESIÓN REAL
    // ==================================
    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      twofa_enabled: 1,
    };

    req.session.twofaValidado = true;

    // Actualizar último acceso
    await db.query("UPDATE usuarios SET fecha_acceso = NOW() WHERE id = ?", [
      usuario.id,
    ]);

    // Eliminar usuario temporal
    delete req.session.tempUser;

    // Redirigir según el rol
    const rol = usuario.rol ? usuario.rol.toLowerCase() : "";

    if (rol === "administrador" || rol === "admin") {
      return res.redirect("/admin");
    } else if (rol === "tecnico" || rol === "técnico") {
      return res.redirect("/tecnico");
    } else {
      return res.redirect("/usuarios");
    }
  } catch (error) {
    console.error("❌ Error verificando 2FA:", error);

    return res.render("verificar_2fa", {
      title: "Verificación 2FA",
      error: "Error interno validando el código",
    });
  }
});

export default router;
