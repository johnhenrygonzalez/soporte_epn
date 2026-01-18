// models/ticketsModel.js
import db from './db.js';

export const crearTicketDB = async (nombre, correo, descripcion) => {
  const [result] = await db.query(
    'INSERT INTO tickets (nombre, correo, descripcion) VALUES (?, ?, ?)',
    [nombre, correo, descripcion]
  );
  return result.insertId;
};

export const obtenerTickets = async () => {
  const [rows] = await db.query('SELECT * FROM tickets ORDER BY fecha_creacion DESC');
  return rows;
};

export const actualizarEstado = async (id, nuevoEstado) => {
  const [result] = await db.query(
    'UPDATE tickets SET estado = ? WHERE id = ?',
    [nuevoEstado, id]
  );
  return result;
};

import pool from './db.js';

// ==========================================
// OBTENER CANTIDAD DE TICKETS ACTIVOS Y CERRADOS
// ==========================================
export const obtenerContadoresTickets = async () => {
  const [activos] = await pool.query(
    "SELECT COUNT(*) AS total FROM tickets WHERE estado = 'Activo'"
  );
  const [cerrados] = await pool.query(
    "SELECT COUNT(*) AS total FROM tickets WHERE estado = 'Cerrado'"
  );

  return {
    activos: activos[0].total,
    cerrados: cerrados[0].total,
  };
};