import db from "../config/db.js";

/**
 * Muestra la vista de seguridad con la lista de usuarios
 * (Admins, Técnicos y Usuarios)
 */
export const vistaSeguridad = async (req, res) => {
  try {
    // Obtenemos todos los usuarios
    const [usuarios] = await db.query(`
      SELECT 
        id,
        nombre,
        correo,
        rol,
        twofa_enabled AS tiene2FA   -- Alias para que la vista use "tiene2FA"
      FROM usuarios
      ORDER BY 
        FIELD(rol, 'Administrador', 'Tecnico', 'Usuario'),
        nombre
    `);

    res.render("admin/seguridad", {
      usuarios,
      usuarioSesion: req.session.usuario
    });
  } catch (error) {
    console.error("Error al cargar vista seguridad:", error);
    res.status(500).send("Error interno del servidor al cargar seguridad.");
  }
};

/**
 * Reinicia el 2FA de un usuario específico:
 * - Limpia el secret (twofa_secret = NULL)
 * - Desactiva el 2FA (twofa_enabled = 0)
 */
export const reiniciar2FA = async (req, res) => {
  const usuarioId = req.params.id;

  try {
    await db.query(
      `
      UPDATE usuarios
      SET 
        twofa_secret = NULL,
        twofa_enabled = 0
      WHERE id = ?
      `,
      [usuarioId]
    );

    // Si usas connect-flash, estos mensajes aparecerán en la vista
    if (req.flash) {
      req.flash("success", "2FA reiniciado correctamente para el usuario seleccionado.");
    }

    res.redirect("/admin/seguridad");
  } catch (error) {
    console.error("Error al reiniciar 2FA:", error);

    if (req.flash) {
      req.flash("error", "No se pudo reiniciar el 2FA. Intenta nuevamente.");
    }

    res.redirect("/admin/seguridad");
  }
};
