// ==========================================
// 📌 mensajesController.js (VERSIÓN COMPLETA)
// ==========================================

import db from "../models/db.js";
import { enviarCorreo } from "../utils/mailer.js";


// ========================================================
// 📌 VISTA PRINCIPAL: FORMULARIO PARA ENVIAR MENSAJES
// ========================================================
export const vistaMensajesTecnicos = async (req, res) => {
  try {
    const [tecnicos] = await db.query(
      "SELECT id, nombre FROM usuarios WHERE rol = 'Técnico' ORDER BY nombre ASC"
    );

    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/mensajes_tecnicos", {
      usuarioSesion: req.session.usuario,
      tecnicos,
      mensajeExito: null,
      mensajeError: null,
      logo
    });

  } catch (error) {
    console.error("❌ Error cargando la vista de mensajes:", error);
    res.status(500).send("Error al cargar la vista de mensajes");
  }
};


// ========================================================
// 📌 PROCESAR ENVÍO DE MENSAJE (LLAMADO POR FETCH)
// ========================================================
export const enviarMensaje = async (req, res) => {
  try {
    const { destinatario_tipo, destinatario_id, asunto, mensaje } = req.body;
    const adminId = req.session.usuario.id;

    // ===========================
    // 1️⃣ ENVIAR A UN SOLO TÉCNICO
    // ===========================
    if (destinatario_tipo === "uno") {
      const [rows] = await db.query(
        "SELECT correo FROM usuarios WHERE id = ? AND rol = 'Técnico'",
        [destinatario_id]
      );

      if (!rows.length) {
        return res.json({ ok: false, error: "El técnico no existe." });
      }

      const correoDestino = rows[0].correo;

      // Enviar correo
      await enviarCorreo(correoDestino, asunto, mensaje);

      // Guardar registro
      await db.query(
        `INSERT INTO mensajes_admin 
         (admin_id, destinatario_id, destinatario_tipo, asunto, mensaje)
         VALUES (?, ?, 'uno', ?, ?)`,
        [adminId, destinatario_id, asunto, mensaje]
      );
    }


    // ===========================
    // 2️⃣ ENVIAR A TODOS LOS TÉCNICOS
    // ===========================
    else if (destinatario_tipo === "todos") {

      const [tecnicos] = await db.query(
        "SELECT correo FROM usuarios WHERE rol = 'Técnico'"
      );

      for (const tec of tecnicos) {
        await enviarCorreo(tec.correo, asunto, mensaje);
      }

      // Guardar registro
      await db.query(
        `INSERT INTO mensajes_admin 
         (admin_id, destinatario_id, destinatario_tipo, asunto, mensaje)
         VALUES (?, NULL, 'todos', ?, ?)`,
        [adminId, asunto, mensaje]
      );
    }


    // ===========================
    // 3️⃣ RESPUESTA PARA FETCH (MUY IMPORTANTE)
    // ===========================
    return res.json({ ok: true });

  } catch (error) {
    console.error("❌ Error enviando mensaje:", error);

    return res.json({
      ok: false,
      error: "No se pudo enviar el mensaje: " + error.message
    });
  }
};
