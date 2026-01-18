// utils/auditoria.js
import db from '../models/db.js';

export async function registrarAuditoria({
  req,
  accion,
  entidad,
  entidad_id,
  antes = null,
  despues = null
}) {
  try {
    const usuario_id = req?.session?.usuario?.id || null;
    const ip = req?.ip || null;
    const userAgent = req?.headers['user-agent'] || null;

    const sql = `
      INSERT INTO auditoria
      (usuario_id, accion, entidad, entidad_id, antes_json, despues_json, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(sql, [
      usuario_id,
      accion,
      entidad,
      entidad_id,
      antes ? JSON.stringify(antes) : null,
      despues ? JSON.stringify(despues) : null,
      ip,
      userAgent
    ]);
  } catch (error) {
    // ⚠️ La auditoría NUNCA debe romper el sistema
    console.error('❌ Error auditoría:', error.message);
  }
}
