// ===============================================
// RUTA: routes/tecnico.js
// ===============================================
import express from "express";
import db from "../models/db.js";
import { enviarCorreo } from "../utils/mailer.js";

const router = express.Router();

/* ===========================================================
   Middleware: verificar si el usuario es técnico
   =========================================================== */
function verificarTecnico(req, res, next) {
  if (!req.session.usuario) return res.redirect("/login");

  const rol = req.session.usuario.rol?.toLowerCase();
  if (!["tecnico", "técnico"].includes(rol)) {
    return res.status(403).send("Acceso denegado");
  }
  next();
}

/* ===========================================================
   GET: Panel del técnico
   =========================================================== */
router.get("/", verificarTecnico, async (req, res) => {
  try {
    const tecnicoId = req.session.usuario.id;

    const [tickets] = await db.query(
      "SELECT * FROM tickets WHERE tecnico_id = ? AND estado <> 'Cerrado' ORDER BY fecha_creacion DESC",
      [tecnicoId]
    );

    const [cerrados] = await db.query(
      "SELECT COUNT(*) AS total FROM tickets WHERE tecnico_id = ? AND estado = 'Cerrado'",
      [tecnicoId]
    );

    // 🔵 Cargar logo
    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("tecnico/panel", {
      titulo: "Panel del Técnico",
      usuarioSesion: req.session.usuario,
      tickets,
      totalAsignados: tickets.filter(t => t.estado === "Asignado").length,
      totalEnProceso: tickets.filter(t => t.estado === "En progreso").length,
      totalFinalizados: cerrados[0].total,
      logo: logo   // ✔ FIX
    });

  } catch (error) {
    console.error("❌ Error panel técnico:", error);
    res.status(500).send("Error al cargar panel técnico");
  }
});

/* ===========================================================
   GET: Formulario de actualización de ticket
   =========================================================== */
router.get("/tickets/actualizar/:id", verificarTecnico, async (req, res) => {
  const tecnicoId = req.session.usuario.id;
  const { id } = req.params;

  try {
    const [rows] = await db.query(
      "SELECT * FROM tickets WHERE id = ? AND tecnico_id = ?",
      [id, tecnicoId]
    );

    if (!rows.length) {
      return res.status(403).send("No tienes permiso para ver este ticket.");
    }

    if (rows[0].estado === "Cerrado") {
      return res.status(400).send("Este ticket ya está cerrado.");
    }

    // 🔵 Logo también aquí
    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("tecnico/actualizar_ticket", {
      titulo: "Actualizar Ticket",
      usuarioSesion: req.session.usuario,
      ticket: rows[0],
      logo: logo
    });

  } catch (error) {
    console.error("❌ Error cargar ticket:", error);
    res.status(500).send("Error al cargar ticket");
  }
});

/* ===========================================================
   POST: Actualizar ticket + HISTORIAL DETALLADO
   =========================================================== */
router.post("/tickets/actualizar/:id", verificarTecnico, async (req, res) => {
  const tecnicoId = req.session.usuario.id;
  const tecnicoNombre = req.session.usuario.nombre;

  const { id } = req.params;
  const { descripcion_operacion, estado } = req.body;

  try {
    const [rows] = await db.query(
      "SELECT * FROM tickets WHERE id = ? AND tecnico_id = ?",
      [id, tecnicoId]
    );

    if (!rows.length) return res.status(403).send("No tienes permiso.");
    if (rows[0].estado === "Cerrado") return res.status(400).send("Ticket cerrado.");

    const ticket = rows[0];

    const estadosPermitidos = ["En progreso", "Cerrado"];
    if (!estadosPermitidos.includes(estado)) {
      return res.status(400).send("Estado no permitido.");
    }

    // Actualizar ticket
    await db.query(
      `
      UPDATE tickets 
      SET descripcion_operacion = ?, estado = ?, fecha_actualizacion = NOW() 
      WHERE id = ?
      `,
      [descripcion_operacion, estado, id]
    );

    // Registrar historial
    let accionHistorial = "";
    let descripcionHistorial = "";

    if (estado === "En progreso") {
      accionHistorial = "Cambio a En progreso";
      descripcionHistorial = `El técnico inició el trabajo: ${descripcion_operacion}`;
    }

    if (estado === "Cerrado") {
      accionHistorial = "Cierre del ticket";
      descripcionHistorial = `El ticket fue cerrado. Trabajo realizado: ${descripcion_operacion}`;
    }

    await db.query(
      `INSERT INTO tickets_historial (ticket_id, usuario, accion, descripcion)
       VALUES (?, ?, ?, ?)`,
      [id, tecnicoNombre, accionHistorial, descripcionHistorial]
    );

    // Enviar correo si se cerró
    if (estado === "Cerrado") {
      await enviarCorreo(
        ticket.correo,
        "✔ Tu ticket ha sido cerrado - Soporte TI EPN",
        `
        <h2>✔ Ticket cerrado</h2>
        <p>Hola ${ticket.nombre},</p>
        <p>Tu ticket #${ticket.id} ha sido cerrado.</p>

        <p><strong>Trabajo realizado:</strong></p>
        <div style="background:#eee;padding:10px;border-radius:6px">
          ${descripcion_operacion}
        </div>
        `
      );
    }

    return res.redirect("/tecnico");

  } catch (error) {
    console.error("❌ Error actualizar ticket:", error);
    res.status(500).send("Error al actualizar ticket");
  }
});

/* ===========================================================
   📜 HISTORIAL DEL TICKET (TÉCNICO)
   =========================================================== */
router.get("/ticket/:id/historial", verificarTecnico, async (req, res) => {
  try {
    const tecnicoId = req.session.usuario.id;
    const { id } = req.params;

    const [ticketRows] = await db.query(
      "SELECT * FROM tickets WHERE id = ? AND tecnico_id = ?",
      [id, tecnicoId]
    );

    if (!ticketRows.length) {
      return res.status(403).send("No tienes acceso a este ticket.");
    }

    const [historial] = await db.query(
      "SELECT * FROM tickets_historial WHERE ticket_id = ? ORDER BY fecha ASC",
      [id]
    );

    // 🔵 Agregar logo también aquí
    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("historial_ticket", {
      titulo: `Historial Ticket #${ticketRows[0].id}`,
      usuarioSesion: req.session.usuario,
      ticket: ticketRows[0],
      historial,
      logo: logo
    });

  } catch (error) {
    console.error("❌ Error historial técnico:", error);
    res.status(500).send("Error al cargar historial");
  }
});

export default router;
