// controllers/ticketsController.js
import db from "../models/db.js";
import { crearTicketDB } from '../models/ticketsModel.js';
import { enviarCorreo } from "../utils/mailer.js";
import { registrarHistorial } from "../models/historialModel.js";
import { registrarAuditoria } from "../utils/auditoria.js";

// ======================================================
// 🔹 Función para obtener logo y nombre institución
// ======================================================
async function obtenerConfig() {
  const [rows] = await db.query(
    "SELECT logo, nombre_institucion FROM configuracion_general LIMIT 1"
  );

  return rows.length
    ? rows[0]
    : { logo: null, nombre_institucion: "Soporte Técnico" };
}

// ======================================================
// 🔹 Mostrar formulario público
// ======================================================
export const crearTicket = async (req, res) => {
  const config = await obtenerConfig();

  res.render("index", {
    mensaje: null,
    logo: config.logo,
    nombre: config.nombre_institucion
  });
};

// ======================================================
// 🔹 Guardar ticket + historial + correo
// ======================================================
export const guardarTicket = async (req, res) => {
  try {
    const { nombre, correo, descripcion } = req.body;

    // 1️⃣ Guardar ticket
    const ticketId = await crearTicketDB(nombre, correo, descripcion);

    // 🔍 Auditoría: creación de ticket
    await registrarAuditoria(
      null,                 // usuario_id (es público, no logueado)
      "CREAR_TICKET",       // acción
      "tickets",            // entidad
      ticketId,             // ID del ticket creado
      null,                 // antes (no existía)
      { nombre, correo, descripcion }, // después
      req                   // IP y navegador
    );

    // 2️⃣ Historial
    await registrarHistorial(
      ticketId,
      nombre,
      "Creado",
      "El ticket fue creado por el usuario desde el formulario público."
    );

    // 3️⃣ Correo al usuario
    await enviarCorreo(
      correo,
      "✔️ Ticket creado con éxito - Soporte TI EPN",
      `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>🎫 Ticket creado exitosamente</h2>
        <p>Hola <strong>${nombre}</strong>, hemos recibido tu solicitud de soporte.</p>
        <p><strong>Número del Ticket:</strong> ${ticketId}</p>
        <p>Un técnico revisará tu caso a la brevedad.</p>
        <br>
        <small>No respondas este mensaje, fue generado automáticamente.</small>
      </div>
      `
    );

    // 4️⃣ Volver a cargar index con mensaje + logo + nombre institución
    const config = await obtenerConfig();

    res.render("index", {
      mensaje: "✅ Ticket enviado correctamente.",
      logo: config.logo,
      nombre: config.nombre_institucion
    });

  } catch (error) {
    console.error("❌ Error al guardar o notificar ticket:", error);

    const config = await obtenerConfig();

    res.render("index", {
      mensaje: "❌ Error al enviar el ticket.",
      logo: config.logo,
      nombre: config.nombre_institucion
    });
  }
};
