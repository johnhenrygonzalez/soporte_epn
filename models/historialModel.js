// models/historialModel.js
import db from "./db.js";

/**
 * Registra un evento en el historial del ticket
 * @param {number} ticketId - ID del ticket
 * @param {string} usuario - Nombre o rol de quien hizo el cambio
 * @param {string} accion - Tipo de acción ("Creado", "Asignado", "Actualizado", "Cerrado")
 * @param {string} descripcion - Detalle del evento
 */
export async function registrarHistorial(ticketId, usuario, accion, descripcion = "") {
  try {
    await db.query(
      `INSERT INTO tickets_historial (ticket_id, usuario, accion, descripcion)
       VALUES (?, ?, ?, ?)`,
      [ticketId, usuario, accion, descripcion]
    );

    console.log(`📌 Historial registrado: Ticket ${ticketId} - ${accion}`);
  } catch (error) {
    console.error("❌ Error al guardar historial:", error);
  }
}
