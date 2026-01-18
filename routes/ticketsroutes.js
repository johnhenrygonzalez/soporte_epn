// routes/ticketsRoutes.js
import express from "express";
import db from "../models/db.js";
import { crearTicket, guardarTicket } from "../controllers/ticketsController.js";

const router = express.Router();

/* ===========================================================
   🟦 Ruta pública — Mostrar formulario con logo dinámico
   =========================================================== */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT logo, nombre_institucion
      FROM configuracion_general
      LIMIT 1
    `);

    const logo = rows.length ? rows[0].logo : null;
    const nombre = rows.length ? rows[0].nombre_institucion : "Soporte Técnico";

    // Renderiza tu formulario index.ejs, enviando logo y nombre
    res.render("index", {
      logo,
      nombre,
    });

  } catch (error) {
    console.error("❌ Error cargando configuración inicial:", error);

    // En caso de error, renderiza sin logo
    res.render("index", {
      logo: null,
      nombre: "Soporte Técnico",
    });
  }
});

/* ===========================================================
   🟩 Ruta pública — Guardar ticket
   =========================================================== */
router.post("/crear", guardarTicket);

export default router;
