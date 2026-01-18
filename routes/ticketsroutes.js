// routes/ticketsroutes.js
import express from "express";
import db from "../models/db.js";
import { guardarTicket } from "../controllers/ticketsController.js";

const router = express.Router();

/* ===========================================================
   🟦 Ruta pública — Página principal
   - Con BD: carga logo y nombre desde configuracion_general
   - Sin BD: modo DEMO (Render)
   =========================================================== */
router.get("/", async (req, res) => {
  // 🟡 MODO DEMO (sin base de datos)
  if (!db) {
    return res.render("index", {
      logo: null,
      nombre: "Soporte Técnico (Demo)",
    });
  }

  // 🟢 MODO NORMAL (con base de datos)
  try {
    const [rows] = await db.query(`
      SELECT logo, nombre_institucion
      FROM configuracion_general
      LIMIT 1
    `);

    const logo = rows.length ? rows[0].logo : null;
    const nombre = rows.length
      ? rows[0].nombre_institucion
      : "Soporte Técnico";

    res.render("index", {
      logo,
      nombre,
    });

  } catch (error) {
    console.error("❌ Error cargando configuración inicial:", error);

    // Fallback seguro
    res.render("index", {
      logo: null,
      nombre: "Soporte Técnico",
    });
  }
});

/* ===========================================================
   🟩 Ruta pública — Guardar ticket
   ⚠️ En modo demo NO guarda nada
   =========================================================== */
router.post("/crear", async (req, res) => {
  if (!db) {
    return res.status(503).send(
      "Modo demostración: creación de tickets deshabilitada"
    );
  }

  // Si hay BD, usa el controlador real
  return guardarTicket(req, res);
});

export default router;
