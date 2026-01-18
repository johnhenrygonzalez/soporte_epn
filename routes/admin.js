// routes/admin.js
import express from "express";
import bcrypt from "bcrypt";
import db from "../models/db.js";
import { enviarCorreoNuevoUsuario, enviarCorreo } from "../utils/mailer.js";
import nodemailer from "nodemailer";
import { cifrarTexto } from "../utils/encryption.js";
import multer from "multer";
import { vistaMensajesTecnicos, enviarMensaje } from "../controllers/mensajesController.js";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { registrarAuditoria } from "../utils/auditoria.js";

console.log("✅ admin.js cargado");
console.log("🟢 ADMIN ROUTES CARGADO");

const router = express.Router();
/* ===========================================================
   📁 Multer para subir logo
   =========================================================== */
const upload = multer({ dest: "uploads/" });

/* ===========================================================
   🛡️ Middleware: Verificar si el usuario es administrador
   =========================================================== */
function verificarAdmin(req, res, next) {
  if (
    !req.session.usuario ||
    !["admin", "administrador"].includes(req.session.usuario.rol.toLowerCase())
  ) {
    return res.status(403).send("Acceso denegado");
  }
  next();
}

/* ===========================================================
   📊 PANEL PRINCIPAL DEL ADMINISTRADOR
   =========================================================== */
router.get("/", verificarAdmin, async (req, res) => {
  try {
    const [admins] = await db.query(`
      SELECT COUNT(*) AS total 
      FROM usuarios 
      WHERE LOWER(rol) IN ('admin', 'administrador')
    `);

    const [tecnicos] = await db.query(`
      SELECT COUNT(*) AS total 
      FROM usuarios 
      WHERE LOWER(rol) IN ('tecnico', 'técnico')
    `);

    const [pendientes] = await db.query(`
      SELECT COUNT(*) AS total 
      FROM tickets 
      WHERE estado = 'Pendiente'
    `);

    const [cerrados] = await db.query(`
      SELECT COUNT(*) AS total 
      FROM tickets 
      WHERE estado = 'Cerrado'
    `);

    const [asignados] = await db.query(`
      SELECT COUNT(*) AS total 
      FROM tickets 
      WHERE tecnico_id IS NOT NULL OR estado = 'En progreso'
    `);

    const [conf] = await db.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    res.render("panel", {
      title: "Panel Admin",
      pageType: "admin",
      usuarioSesion: req.session.usuario,
      totalAdmins: admins[0].total,
      totalTecnicos: tecnicos[0].total,
      totalActivos: pendientes[0].total,
      totalCerrados: cerrados[0].total,
      totalAsignados: asignados[0].total,
      logo
    });
  } catch (error) {
    console.error("❌ Error al obtener datos del panel:", error);
    res.status(500).send("Error al cargar el panel del administrador");
  }
});

/* ===========================================================
    RUTA MOSTRAR QR
   =========================================================== */
router.get("/activar-2fa", async (req, res) => {
  try {
    // 1️⃣ Debe haber sesión temporal o normal
    if (!req.session.tempUser && !req.session.usuario) {
      return res.redirect("/login");
    }

    // 2️⃣ Usuario actual
    const user = req.session.tempUser || req.session.usuario;

    // Si ya tiene 2FA activado, redirigir
    if (user.twofa_enabled === 1) {
      return res.redirect("/admin");
    }

    // 3️⃣ Generar secreto y QR
    const secret = speakeasy.generateSecret({
      name: "Soporte TI EPN",
      length: 20
    });

    const qr = await QRCode.toDataURL(secret.otpauth_url);

    // 4️⃣ Cargar logo
    const [conf] = await db.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    // 5️⃣ Mostrar vista
    res.render("admin/activar_2fa", {
      usuarioSesion: user,
      secret: secret.base32,
      qr,
      logo,
      error: null
    });

  } catch (error) {
    console.error("❌ Error en /activar-2fa:", error);
    res.status(500).send("Error al cargar 2FA");
  }
});

// ===========================================================
//  RUTA POST → ACTIVAR 2FA (guardar en BD)
// ===========================================================
router.post("/activar-2fa", async (req, res) => {
  try {
    // Debe haber sesión de usuario
    if (!req.session.usuario) {
      return res.redirect("/login");
    }

    const { secret, token } = req.body;
    const user = req.session.usuario;
    
    if (user.twofa_enabled === 1) {
      return res.redirect("/admin");
    }


    // Verificar el código TOTP
    const verified = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token,
      window: 1   // pequeña tolerancia de tiempo
    });

    if (!verified) {
      // Volver a generar el QR para mostrarlo otra vez
      const otpauth_url = `otpauth://totp/Soporte%20TI%20EPN?secret=${secret}&issuer=Soporte%20TI%20EPN`;
      const qr = await QRCode.toDataURL(otpauth_url);

      const [conf] = await db.query(
        "SELECT logo FROM configuracion_general LIMIT 1"
      );
      const logo = conf.length ? conf[0].logo : null;

      return res.render("admin/activar_2fa", {
        usuarioSesion: user,
        secret,
        qr,
        logo,
        error: "Código incorrecto, intenta nuevamente."
      });
    }

    // Código correcto → guardar en BD
    await db.query(
      "UPDATE usuarios SET twofa_secret = ?, twofa_enabled = 1 WHERE id = ?",
      [secret, user.id]
    );

    await registrarAuditoria({
      req,
      accion: "ACTIVAR_2FA",
      entidad: "usuarios",
      entidad_id: user.id,
      antes: { twofa_enabled: 0 },
      despues: { twofa_enabled: 1 }
    });

    // Actualizar también la sesión en memoria
    req.session.usuario.twofa_enabled = 1;
    req.session.usuario.twofa_secret = secret;

    // Enviar correo de notificación (opcional, no bloquea si falla)
    try {
      await enviarCorreo(
        user.correo,
        "🔐 2FA activado en Soporte TI EPN",
        `
        <div style="font-family: Arial; color:#333">
          <h2>🔐 Autenticación en dos pasos activada</h2>
          <p>Hola <strong>${user.nombre}</strong>,</p>
          <p>La autenticación en dos pasos (2FA) ha sido activada correctamente para tu cuenta en el sistema de Soporte TI EPN.</p>
        </div>
        `
      );
    } catch (e) {
      console.error("⚠️ Error enviando correo de notificación 2FA:", e.message);
      // pero NO cancelamos la activación por esto
    }

    // Redirigir al panel admin
    return res.redirect("/admin");

  } catch (error) {
    console.error("❌ Error activando 2FA:", error);
    res.status(500).send("Error al activar 2FA");
  }
});

/* ===========================================================
   👥 LISTADOS SEPARADOS POR ROL
   =========================================================== */
router.get("/administradores", verificarAdmin, async (req, res) => {
  try {
    const [admins] = await db.query(`
      SELECT id, nombre, correo, rol 
      FROM usuarios 
      WHERE LOWER(rol) IN ('admin', 'administrador')
      ORDER BY nombre ASC
    `);

      const [conf] = await db.query(
        "SELECT logo FROM configuracion_general LIMIT 1"
      );
      const logo = conf.length ? conf[0].logo : null;

    res.render("admin/admin_lista", {
      titulo: "Lista de Administradores",
      usuarioSesion: req.session.usuario,
      usuarios: admins,
      logo
    });
  } catch (error) {
    console.error("❌ Error al obtener administradores:", error);
    res.status(500).send("Error al cargar administradores");
  }
});

router.get("/tecnicos", verificarAdmin, async (req, res) => {
  try {
    const [tecnicos] = await db.query(`
      SELECT id, nombre, correo, rol 
      FROM usuarios 
      WHERE LOWER(rol) IN ('tecnico', 'técnico')
      ORDER BY nombre ASC
    `);

    const [conf] = await db.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/admin_lista", {
      titulo: "Lista de Técnicos",
      usuarioSesion: req.session.usuario,
      usuarios: tecnicos,
      logo
    });
  } catch (error) {
    console.error("❌ Error al obtener técnicos:", error);
    res.status(500).send("Error al cargar técnicos");
  }
});

/* ===========================================================
   🎫 GESTIÓN DE TICKETS GENERAL
   =========================================================== */
router.get("/tickets", verificarAdmin, async (req, res) => {
  try {
    const estado = req.query.estado || "Pendiente";

    const [tickets] = await db.query(
      `SELECT 
          t.id,
          t.nombre,
          t.correo,
          t.descripcion,
          t.estado,
          t.fecha_creacion,
          u.nombre AS tecnico
        FROM tickets t
        LEFT JOIN usuarios u ON u.id = t.tecnico_id
        WHERE t.estado = ?
        ORDER BY t.fecha_creacion DESC`,
      [estado]
    );

    const [tecnicos] = await db.query(`
      SELECT id, nombre 
      FROM usuarios 
      WHERE LOWER(rol) IN ('tecnico', 'técnico')
      ORDER BY nombre ASC
    `);

    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("tickets_admin", {
      usuarioSesion: req.session.usuario,
      tickets,
      tecnicos,
      estado,
      logo
    });
  } catch (error) {
    console.error("❌ Error al obtener tickets:", error);
    res.status(500).send("Error al cargar los tickets");
  }
});

/* ===========================================================
   🎯 ASIGNAR TÉCNICO + HISTORIAL + CORREO (CORRECCIÓN COMPLETA)
   =========================================================== */
router.post("/asignar-tecnico/:id", verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tecnicoId } = req.body;

    if (!tecnicoId) {
      return res.status(400).json({
        success: false,
        message: "Debe seleccionar un técnico",
      });
    }

    // Obtener ticket
    const [ticketRows] = await db.query(
      "SELECT * FROM tickets WHERE id = ?",
      [id]
    );
      
    if (!ticketRows.length)
      return res.status(404).json({
        success: false,
        message: "Ticket no encontrado",
      });

    const ticket = ticketRows[0];

    // Obtener técnico
    const [tecRows] = await db.query(
      "SELECT id, nombre, correo FROM usuarios WHERE id = ?",
      [tecnicoId]
    );

    if (!tecRows.length) {
      return res.status(404).json({
        success: false,
        message: "Técnico no encontrado",
      });
    }

    const tecnico = tecRows[0];

    // Actualizar ticket
    await db.query(
      "UPDATE tickets SET tecnico_id = ?, estado = 'Asignado' WHERE id = ?",
      [tecnicoId, id]
    );

    await registrarAuditoria({
      req,
      accion: "ASIGNAR_TECNICO",
      entidad: "tickets",
      entidad_id: id,
      antes: {
        tecnico_id: ticket.tecnico_id,
        estado: ticket.estado
      },
      despues: {
        tecnico_id: tecnicoId,
        estado: "Asignado"
      }
    });

    // Registrar historial
    await db.query(
      `INSERT INTO tickets_historial (ticket_id, usuario, accion, descripcion)
       VALUES (?, ?, 'Asignado', ?)`,
      [
        id,
        req.session.usuario.nombre,
        `El ticket fue asignado al técnico ${tecnico.nombre}`,
      ]
    );

    /* ===========================================================
       📧 ENVIAR CORREOS (USUARIO + TÉCNICO) — CORREGIDO
       =========================================================== */

    await Promise.all([
      
      // 🔵 Correo al usuario
      enviarCorreo(
        ticket.correo,
        "🔧 Tu ticket ha sido asignado - Soporte TI EPN",
        `
        <div style="font-family: Arial; color:#333">
          <h2>🔧 Ticket asignado</h2>
          <p>Hola <strong>${ticket.nombre}</strong>,</p>
          <p>Tu ticket <strong>#${ticket.id}</strong> fue asignado al técnico:</p>
          <h3 style="color:#007bff">${tecnico.nombre}</h3>
        </div>`
      ),

      // 🟢 Correo al técnico
      enviarCorreo(
        tecnico.correo,
        "📩 Nuevo ticket asignado - Soporte TI EPN",
        `
        <div style="font-family: Arial; color:#333">
          <h2>📩 Nuevo Ticket Asignado</h2>
          <p>Hola <strong>${tecnico.nombre}</strong>,</p>

          <p>Se te ha asignado el ticket <strong>#${ticket.id}</strong>.</p>

          <h3>Detalles del Ticket:</h3>
          <p><strong>Usuario:</strong> ${ticket.nombre} (${ticket.correo})</p>
          <p><strong>Descripción:</strong></p>
          <p>${ticket.descripcion}</p>

          <p>Por favor ingresa al sistema para revisarlo.</p>
        </div>`
      )

    ]);

    res.json({
      success: true,
      message: "Técnico asignado y correos enviados 📧📧",
    });

  } catch (error) {
    console.error("❌ Error asignando técnico:", error);
    res.status(500).json({
      success: false,
      message: "Error al asignar técnico: " + error.message,
    });
  }
});

// =====================
// 📩 Vista: Enviar mensajes a técnicos
// =====================
router.get("/mensajes-tecnicos", verificarAdmin, async (req, res) => {
  try {
    // Obtener técnicos
    const [tecnicos] = await db.query(
      "SELECT id, nombre, correo FROM usuarios WHERE rol = 'Técnico'"
    );

    // Obtener logo
    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    // Renderizar vista con todas las variables necesarias
    res.render("admin/mensajes_tecnicos", {
      title: "Mensajes a Técnicos",
      tecnicos,
      usuarioSesion: req.session.usuario,
      logo,
      mensajeExito: null,
      mensajeError: null
    });

  } catch (error) {
    console.error("Error cargando técnicos:", error);

    res.render("admin/mensajes_tecnicos", {
      title: "Mensajes a Técnicos",
      tecnicos: [],
      usuarioSesion: req.session.usuario,
      logo: null,
      mensajeExito: null,
      mensajeError: "Error interno al cargar técnicos"
    });
  }
});

/* ===========================================================
   📌 TICKETS ASIGNADOS — FILTROS + PAGINACIÓN
   =========================================================== */
router.get("/tickets/asignados", verificarAdmin, async (req, res) => {
  try {
    const limpiar = (v) => (v && v.trim() !== "" ? v.trim() : null);

    const tecnico_id = limpiar(req.query.tecnico_id);
    const fecha_desde = limpiar(req.query.fecha_desde);
    const fecha_hasta = limpiar(req.query.fecha_hasta);
    const estado = limpiar(req.query.estado);
    const pagina = parseInt(req.query.pagina) || 1;

    const limite = 10;
    const offset = (pagina - 1) * limite;

    // Obtener técnicos para el filtro
    const [tecnicos] = await db.query(`
      SELECT id, nombre 
      FROM usuarios 
      WHERE LOWER(rol) IN ('tecnico','técnico')
      ORDER BY nombre ASC
    `);

    // Obtener tickets asignados
    const [tickets] = await db.query(
      `
      SELECT 
        t.id,
        t.nombre,
        t.descripcion,
        t.estado,
        t.fecha_creacion,
        u.nombre AS tecnico
      FROM tickets t
      LEFT JOIN usuarios u ON u.id = t.tecnico_id
      WHERE t.tecnico_id IS NOT NULL
        AND ( ? IS NULL OR t.tecnico_id = ? )
        AND ( ? IS NULL OR DATE(t.fecha_creacion) >= ? )
        AND ( ? IS NULL OR DATE(t.fecha_creacion) <= ? )
        AND ( ? IS NULL OR t.estado = ? )
      ORDER BY t.id DESC
      LIMIT ? OFFSET ?
      `,
      [
        tecnico_id,
        tecnico_id,
        fecha_desde,
        fecha_desde,
        fecha_hasta,
        fecha_hasta,
        estado,
        estado,
        limite,
        offset,
      ]
    );

    // Total para paginación
    const [[conteo]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM tickets t
      WHERE t.tecnico_id IS NOT NULL
        AND ( ? IS NULL OR t.tecnico_id = ? )
        AND ( ? IS NULL OR DATE(t.fecha_creacion) >= ? )
        AND ( ? IS NULL OR DATE(t.fecha_creacion) <= ? )
        AND ( ? IS NULL OR t.estado = ? )
      `,
      [
        tecnico_id,
        tecnico_id,
        fecha_desde,
        fecha_desde,
        fecha_hasta,
        fecha_hasta,
        estado,
        estado,
      ]
    );

    const totalPaginas = Math.ceil(conteo.total / limite);

    // Cargar logo institucional
    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/tickets_asignados", {
      titulo: "Tickets Asignados",
      usuarioSesion: req.session.usuario,
      tickets,
      tecnicos,
      filtros: { tecnico_id, fecha_desde, fecha_hasta, estado },
      pagina,
      totalPaginas,
      logo
    });

  } catch (error) {
    console.error("❌ Error cargando tickets asignados:", error);
    res.status(500).send("Error cargando tickets asignados");
  }
});

/* ===========================================================
   📌 TICKETS CERRADOS
   =========================================================== */
router.get("/tickets/cerrados", verificarAdmin, async (req, res) => {
  try {
    const filtros = {
      ticket_id: req.query.ticket_id || "",
      tecnico_id: req.query.tecnico_id || "",
      fecha_desde: req.query.fecha_desde || "",
      fecha_hasta: req.query.fecha_hasta || "",
    };

    const paginaActual = parseInt(req.query.pagina) || 1;
    const limite = 10;
    const offset = (paginaActual - 1) * limite;

    const [tecnicos] = await db.query(`
      SELECT id, nombre
      FROM usuarios
      WHERE LOWER(rol) IN ('tecnico','técnico')
      ORDER BY nombre ASC
    `);

    let where = `WHERE t.estado = 'Cerrado'`;
    const params = [];

    if (filtros.ticket_id) {
      where += ` AND t.id = ?`;
      params.push(filtros.ticket_id);
    }

    if (filtros.tecnico_id) {
      where += ` AND t.tecnico_id = ?`;
      params.push(filtros.tecnico_id);
    }

    if (filtros.fecha_desde) {
      where += ` AND DATE(t.fecha_actualizacion) >= ?`;
      params.push(filtros.fecha_desde);
    }

    if (filtros.fecha_hasta) {
      where += ` AND DATE(t.fecha_actualizacion) <= ?`;
      params.push(filtros.fecha_hasta);
    }

    const [tickets] = await db.query(
      `
      SELECT
        t.id,
        t.nombre,
        t.descripcion,
        t.estado,
        t.fecha_actualizacion AS fecha_cierre,
        u.nombre AS tecnico
      FROM tickets t
      LEFT JOIN usuarios u ON u.id = t.tecnico_id
      ${where}
      ORDER BY fecha_cierre DESC
      LIMIT ${limite} OFFSET ${offset}
      `,
      params
    );

    const [[conteo]] = await db.query(
      `
      SELECT COUNT(*) AS total 
      FROM tickets t
      ${where}
      `,
      params
    );

    const totalPaginas = Math.ceil(conteo.total / limite);

    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/tickets_cerrados", {
      titulo: "Tickets Cerrados",
      usuarioSesion: req.session.usuario,
      tickets,
      tecnicos,
      filtros,
      pagina: paginaActual,
      totalPaginas,
      logo
    });
  } catch (error) {
    console.error("❌ Error en tickets cerrados:", error);
    res.status(500).send("Error cargando tickets cerrados");
  }
});

/* ===========================================================
   📜 HISTORIAL DEL TICKET (ADMIN)
   =========================================================== */
router.get("/ticket/:id/historial", verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener datos del ticket
    const [ticketRows] = await db.query(
      `
      SELECT t.*, u.nombre AS tecnico_nombre
      FROM tickets t
      LEFT JOIN usuarios u ON t.tecnico_id = u.id
      WHERE t.id = ?
      `,
      [id]
    );

    if (!ticketRows.length) {
      return res.status(404).send("Ticket no encontrado");
    }

    const ticket = ticketRows[0];

    // Obtener historial
    const [historial] = await db.query(
      `SELECT * FROM tickets_historial WHERE ticket_id = ? ORDER BY fecha ASC`,
      [id]
    );

    const [cfg] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = cfg.length ? cfg[0].logo : null;

    res.render("historial_ticket", {
      titulo: `Historial del Ticket #${id}`,
      ticket,
      historial,
      usuarioSesion: req.session.usuario,
      pageType: "admin",
      logo
    });

  } catch (error) {
    console.error("❌ Error cargando historial:", error);
    res.status(500).send("Error al cargar historial del ticket");
  }
});

/* ===========================================================
   ⚙️ CONFIGURACIÓN GENERAL
   =========================================================== */
router.get("/configuracion", verificarAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM configuracion_general LIMIT 1");

    res.render("admin/configuracion", {
      title: "Configuración General",
      usuarioSesion: req.session.usuario,
      config: rows.length ? rows[0] : null,
      pageType: "configuracion",
      mensaje: null,
      error: null,
      twofa_enabled: req.session.usuario?.twofa_enabled ?? 0
    });
  } catch (error) {
    console.error("❌ Error cargando configuración:", error);
    res.status(500).send("Error al cargar configuración general");
  }
});

/* ===========================================================
   POST GUARDAR CONFIGURACIÓN
   =========================================================== */
router.post(
  "/configuracion/guardar",
  verificarAdmin,
  upload.single("logo"),
  async (req, res) => {
    try {
      const body = req.body || {};

      const {
        smtp_host = "",
        smtp_port = "",
        smtp_correo = "",
        smtp_password = "",
        smtp_seguridad = "",
      } = body;

      const [rows] = await db.query(
        "SELECT id, smtp_password, logo FROM configuracion_general LIMIT 1"
      );

      let passwordEncriptada = rows.length ? rows[0].smtp_password : null;

      if (smtp_password && smtp_password.trim() !== "") {
        passwordEncriptada = cifrarTexto(smtp_password.trim());
      }

      let logo = rows.length ? rows[0].logo : null;
      if (req.file) {
        logo = req.file.filename;
      }

      if (rows.length) {
        await db.query(
          `UPDATE configuracion_general 
           SET smtp_host=?, smtp_port=?, smtp_correo=?, smtp_password=?, smtp_seguridad=?, logo=?
           WHERE id=?`,
          [
            smtp_host,
            smtp_port,
            smtp_correo,
            passwordEncriptada,
            smtp_seguridad,
            logo,
            rows[0].id,
          ]
        );
      } else {
        await db.query(
          `INSERT INTO configuracion_general 
            (smtp_host, smtp_port, smtp_correo, smtp_password, smtp_seguridad, logo)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            smtp_host,
            smtp_port,
            smtp_correo,
            passwordEncriptada,
            smtp_seguridad,
            logo,
          ]
        );
      }

      res.json({
        success: true,
        message: "Configuración guardada correctamente",
      });
    } catch (error) {
      console.error("❌ Error guardando config:", error);
      res.json({
        success: false,
        message: "Error guardando configuración",
      });
    }
  }
);

/* ===========================================================
   POST — CORREO DE PRUEBA
   =========================================================== */
router.post("/configuracion/probar", verificarAdmin, async (req, res) => {
  try {
    const {
      smtp_host,
      smtp_port,
      smtp_correo,
      smtp_password,
      smtp_seguridad,
    } = req.body;

    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: Number(smtp_port),
      secure: smtp_seguridad === "ssl",
      auth: {
        user: smtp_correo,
        pass: smtp_password,
      },
    });

    await transporter.sendMail({
      from: smtp_correo,
      to: smtp_correo,
      subject: "✔ Correo de prueba - Configuración correcta",
      text: "Este es un correo de prueba enviado correctamente desde Soporte TI EPN.",
    });

    res.json({ success: true, message: "Correo enviado correctamente" });
  } catch (error) {
    console.error("❌ Error enviando correo de prueba:", error);
    res.json({
      success: false,
      message: "Error enviando correo de prueba: " + error.message,
    });
  }
});

/* ===========================================================
   👥 CRUD DE USUARIOS — LISTAR (CON PAGINACIÓN)
   =========================================================== */
router.get("/usuarios", verificarAdmin, async (req, res) => {
  try {
    const filtroRol = req.query.rol || "";
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = 5;
    const offset = (pagina - 1) * limite;

    // ========================
    // WHERE dinámico
    // ========================
    let where = "";
    const params = [];

    if (filtroRol) {
      where = "WHERE rol = ?";
      params.push(filtroRol);
    }

    // ========================
    // TOTAL REGISTROS
    // ========================
    const [[total]] = await db.query(
      `SELECT COUNT(*) AS total FROM usuarios ${where}`,
      params
    );

    const totalPaginas = Math.ceil(total.total / limite);

    // ========================
    // USUARIOS PAGINADOS
    // ========================
    const [usuarios] = await db.query(
      `
      SELECT *
      FROM usuarios
      ${where}
      ORDER BY nombre ASC
      LIMIT ? OFFSET ?
      `,
      [...params, limite, offset]
    );

    // ========================
    // TOTALES POR ROL
    // ========================
    const [[admins]] = await db.query(
      "SELECT COUNT(*) AS total FROM usuarios WHERE LOWER(rol) IN ('admin','administrador')"
    );

    const [[tecnicos]] = await db.query(
      "SELECT COUNT(*) AS total FROM usuarios WHERE LOWER(rol) IN ('tecnico','técnico')"
    );

    // ========================
    // LOGO
    // ========================
    const [conf] = await db.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    // ========================
    // RENDER
    // ========================
    res.render("admin/admin_usuarios", {
      usuarioSesion: req.session.usuario,
      usuarios,
      filtroRol,
      totalAdmins: admins.total,
      totalTecnicos: tecnicos.total,
      pagina,
      totalPaginas,
      logo
    });

  } catch (error) {
    console.error("❌ Error listando usuarios:", error);
    res.status(500).send("Error al listar usuarios");
  }
});

/* ===========================================================
   👤 FORMULARIO — CREAR USUARIO
   =========================================================== */
router.get("/usuarios/crear", verificarAdmin, async (req, res) => {
  const [cfg] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
  const logo = cfg.length ? cfg[0].logo : null;
  res.render("admin/usuarios_form", {
    titulo: "Crear Usuario",
    title: "Nuevo Usuario",
    usuarioSesion: req.session.usuario,
    usuario: null,
    accion: "/admin/usuarios/crear",
    error: null,
    mensaje: null,
    logo
  });
});

/* ===========================================================
   👤 POST — CREAR USUARIO
   =========================================================== */
router.post("/usuarios/crear", verificarAdmin, async (req, res) => {
  try {
    const { nombre, correo, rol, contrasena } = req.body;

    if (!nombre || !correo || !rol || !contrasena) {
      const [cfg] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
      const logo = cfg.length ? cfg[0].logo : null;
      return res.render("admin/usuarios_form", {
        titulo: "Crear Usuario",
        title: "Nuevo Usuario",
        usuarioSesion: req.session.usuario,
        usuario: null,
        accion: "/admin/usuarios/crear",
        error: "Todos los campos son obligatorios",
        mensaje: null,
        logo
      });
    }

    const hashed = await bcrypt.hash(contrasena, 10);

    const [resultado] = await db.query(
      "INSERT INTO usuarios (nombre, correo, rol, password) VALUES (?, ?, ?, ?)",
      [nombre, correo, rol, hashed]
    );

    const nuevoUsuarioId = resultado.insertId;

    await registrarAuditoria({
      req,
      accion: "CREAR_USUARIO",
      entidad: "usuarios",
      entidad_id: nuevoUsuarioId,
      antes: null,
      despues: { nombre, correo, rol }
    });

    await enviarCorreoNuevoUsuario(nombre, correo, rol);

    const [cfg] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = cfg.length ? cfg[0].logo : null;
    
    res.render("admin/usuarios_form", {
      titulo: "Crear Usuario",
      title: "Nuevo Usuario",
      usuarioSesion: req.session.usuario,
      usuario: null,
      accion: "/admin/usuarios/crear",
      error: null,
      mensaje: "Usuario creado correctamente",
      logo
    });
  } catch (error) {
    console.error("❌ Error creando usuario:", error);
    res.status(500).send("Error al crear usuario");
  }
});

/* ===========================================================
   👤 FORMULARIO — EDITAR USUARIO
   =========================================================== */
router.get("/usuarios/editar/:id", verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query("SELECT * FROM usuarios WHERE id = ?", [id]);

    if (!rows.length) return res.status(404).send("Usuario no encontrado");

    const [cfg] = await db.query("SELECT * FROM configuracion_general LIMIT 1");
    const config = cfg.length ? cfg[0] : {};

        res.render("admin/usuarios_form", {
      titulo: "Editar Usuario",
      title: "Editar Usuario",
      usuarioSesion: req.session.usuario,
      usuario: rows[0],
      accion: `/admin/usuarios/editar/${id}`,
      error: null,
      mensaje: null,
      logo: config.logo || null
    });
  } catch (error) {
    console.error("❌ Error cargando usuario:", error);
    res.status(500).send("Error al cargar usuario");
  }
});

/* ===========================================================
   👤 POST — EDITAR USUARIO
   =========================================================== */
router.post("/usuarios/editar/:id", verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, correo, rol } = req.body;

    // 1️⃣ Estado ANTES
    const [[antes]] = await db.query(
      "SELECT nombre, correo, rol FROM usuarios WHERE id = ?",
      [id]
    );

    // 2️⃣ UPDATE
    await db.query(
      "UPDATE usuarios SET nombre = ?, correo = ?, rol = ? WHERE id = ?",
      [nombre, correo, rol, id]
    );

    // 3️⃣ Auditoría
    await registrarAuditoria({
      req,
      accion: "EDITAR_USUARIO",
      entidad: "usuarios",
      entidad_id: id,
      antes,
      despues: { nombre, correo, rol }
    });

    res.redirect("/admin/usuarios");
  } catch (error) {
    console.error("❌ Error editando usuario:", error);
    res.status(500).send("Error al editar usuario");
  }
});

/* ===========================================================
   ❌ ELIMINAR USUARIO (PROTEGIDO)
   - No permitir que el admin se borre a sí mismo
   - No permitir borrar el último admin
   =========================================================== */
router.get("/usuarios/eliminar/:id", verificarAdmin, async (req, res) => {
  try {
    const idEliminar = Number(req.params.id);

    // 0️⃣ Validar ID
    if (!Number.isInteger(idEliminar) || idEliminar <= 0) {
      return res.status(400).send("ID inválido");
    }

    // 1️⃣ No permitir auto-eliminación
    const idSesion = Number(req.session.usuario.id);
    if (idSesion === idEliminar) {
      return res.redirect("/admin/usuarios?error=auto_eliminar");
    }

    // 2️⃣ Obtener usuario a eliminar
    const [rows] = await db.query(
      "SELECT id, nombre, correo, rol FROM usuarios WHERE id = ?",
      [idEliminar]
    );

    if (!rows.length) {
      return res.status(404).send("Usuario no encontrado");
    }

    const antes = rows[0];
    const rolLower = antes.rol.toLowerCase();

    // 3️⃣ Si es admin, validar que NO sea el último
    if (rolLower === "admin" || rolLower === "administrador") {
      const [[conteo]] = await db.query(`
        SELECT COUNT(*) AS total
        FROM usuarios
        WHERE LOWER(rol) IN ('admin','administrador')
      `);

      if (conteo.total <= 1) {
        return res.redirect("/admin/usuarios?error=ultimo_admin");
      }
    }

    // 4️⃣ Eliminar usuario
    await db.query("DELETE FROM usuarios WHERE id = ?", [idEliminar]);

    // 5️⃣ Auditoría
    await registrarAuditoria({
      req,
      accion: "ELIMINAR_USUARIO",
      entidad: "usuarios",
      entidad_id: idEliminar,
      antes,
      despues: null
    });

    return res.redirect("/admin/usuarios?ok=eliminado");

  } catch (error) {
    console.error("❌ Error eliminando usuario:", error);
    return res.status(500).send("Error al eliminar usuario");
  }
});

router.get("/mensajes", verificarAdmin, vistaMensajesTecnicos);
router.post("/mensajes/enviar", verificarAdmin, enviarMensaje);

// 📜 HISTORIAL DE MENSAJES A TÉCNICOS
router.get("/mensajes-historial", verificarAdmin, async (req, res) => {
  try {
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = 10;
    const offset = (pagina - 1) * limite;

    // Helper para limpiar filtros (evita valores "      ")
    const limpiar = (v) => (v && v.trim() !== "" ? v.trim() : null);

    // ==== Filtros que vienen de la vista ====
    const filtros = {
      fecha_desde: limpiar(req.query.fecha_desde),
      fecha_hasta: limpiar(req.query.fecha_hasta),
      destino: limpiar(req.query.destino),        // null | "uno" | "todos"
      tecnico_id: limpiar(req.query.tecnico_id),  // id de técnico o null
    };

    // ==== Construir WHERE dinámico ====
    let where = "WHERE 1=1";
    const params = [];

    if (filtros.fecha_desde) {
      where += " AND DATE(m.fecha) >= ?";
      params.push(filtros.fecha_desde);
    }

    if (filtros.fecha_hasta) {
      where += " AND DATE(m.fecha) <= ?";
      params.push(filtros.fecha_hasta);
    }

    // Si hay técnico, filtramos por mensajes individuales a ese técnico
    if (filtros.tecnico_id) {
      where += " AND m.destinatario_tipo = 'uno' AND m.destinatario_id = ?";
      params.push(filtros.tecnico_id);
    } else if (filtros.destino) {
      // Solo si NO se ha elegido técnico aplicamos filtro por tipo de destino
      where += " AND m.destinatario_tipo = ?";
      params.push(filtros.destino);
    }

    // ==== Consulta principal (con JOINs) ====
    const [mensajes] = await db.query(
      `
      SELECT
        m.*,
        a.nombre AS admin_nombre,
        t.nombre AS tecnico_nombre
      FROM mensajes_admin m
      JOIN usuarios a ON a.id = m.admin_id
      LEFT JOIN usuarios t ON t.id = m.destinatario_id
      ${where}
      ORDER BY m.fecha DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limite, offset]
    );

    // ==== Conteo total para paginación ====
    const [[conteo]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM mensajes_admin m
      ${where}
      `,
      params
    );

    const totalPaginas = Math.ceil(conteo.total / limite);

    // Lista de técnicos para el combo de filtro
    const [tecnicos] = await db.query(`
      SELECT id, nombre
      FROM usuarios
      WHERE LOWER(rol) IN ('tecnico','técnico')
      ORDER BY nombre ASC
    `);

    // Logo
    const [conf] = await db.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/mensajes_historial", {
      titulo: "Historial de Mensajes",
      usuarioSesion: req.session.usuario,
      mensajes,
      pagina,
      totalPaginas,
      filtros,
      logo,
      tecnicos,
    });
  } catch (error) {
    console.error("❌ Error cargando historial de mensajes:", error);
    res.render("admin/mensajes_historial", {
      titulo: "Historial de Mensajes",
      usuarioSesion: req.session.usuario,
      mensajes: [],
      pagina: 1,
      totalPaginas: 1,
      filtros: {
        fecha_desde: "",
        fecha_hasta: "",
        destino: "",
        tecnico_id: "",
      },
      logo: null,
      tecnicos: [],
      error: "Error al cargar historial de mensajes",
    });
  }
});

/* ===========================================================
   🛡️ SEGURIDAD — REINICIAR 2FA
   =========================================================== */

// VISTA PRINCIPAL DE SEGURIDAD
router.get("/seguridad", verificarAdmin, async (req, res) => {
  try {
    // Obtener usuarios con info de 2FA
    const [usuarios] = await db.query(`
      SELECT 
        id,
        nombre,
        correo,
        rol,
        twofa_enabled AS tiene2FA
      FROM usuarios
      ORDER BY 
        FIELD(rol, 'Administrador', 'admin', 'Administrador', 'Técnico', 'Tecnico', 'Usuario'),
        nombre ASC
    `);

    // Cargar logo
    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/seguridad", {
      titulo: "Seguridad – Control 2FA",
      usuarioSesion: req.session.usuario,
      usuarios,
      logo
    });

  } catch (error) {
    console.error("❌ Error cargando vista de seguridad:", error);
    res.status(500).send("Error al cargar seguridad");
  }
});

// REINICIAR 2FA DE UN USUARIO ESPECÍFICO
router.post("/seguridad/reiniciar/:id", verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Estado ANTES
    const [rows] = await db.query(
      "SELECT twofa_enabled FROM usuarios WHERE id = ?",
      [id]
    );

    if (!rows.length) {
      return res.status(404).send("Usuario no encontrado");
    }

    if (rows[0].twofa_enabled === 0) {
      return res.redirect("/admin/seguridad");
    }

    const antes = rows[0];

    // 2️⃣ UPDATE
    await db.query(
      `UPDATE usuarios 
       SET twofa_secret = NULL, twofa_enabled = 0 
       WHERE id = ?`,
      [id]
    );

    // 3️⃣ Auditoría
    await registrarAuditoria({
      req,
      accion: "REINICIAR_2FA",
      entidad: "usuarios",
      entidad_id: id,
      antes,
      despues: { twofa_enabled: 0 }
    });

    res.redirect("/admin/seguridad");
  } catch (error) {
    console.error("❌ Error reiniciando 2FA:", error);
    res.status(500).send("Error al reiniciar 2FA");
  }
});

/* ===========================================================
   📋 AUDITORÍA DE USUARIOS (FILTROS + PAGINACIÓN)
   =========================================================== */
router.get("/auditoria-usuarios", verificarAdmin, async (req, res) => {
  try {
    const limpiar = v => (v && v.trim() !== "" ? v.trim() : null);

    // 🔍 Filtros
    const filtros = {
      accion: limpiar(req.query.accion),
      usuario: limpiar(req.query.usuario),
      fecha_desde: limpiar(req.query.fecha_desde),
      fecha_hasta: limpiar(req.query.fecha_hasta)
    };

    // 📄 Paginación
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = 10;
    const offset = (pagina - 1) * limite;

    let where = "WHERE a.entidad = 'usuarios'";
    const params = [];

    if (filtros.accion) {
      where += " AND a.accion = ?";
      params.push(filtros.accion);
    }

    if (filtros.usuario) {
      where += " AND (u.nombre LIKE ? OR u.correo LIKE ?)";
      params.push(`%${filtros.usuario}%`, `%${filtros.usuario}%`);
    }

    if (filtros.fecha_desde) {
      where += " AND DATE(a.fecha) >= ?";
      params.push(filtros.fecha_desde);
    }

    if (filtros.fecha_hasta) {
      where += " AND DATE(a.fecha) <= ?";
      params.push(filtros.fecha_hasta);
    }

    // 🔢 Total
    const [[conteo]] = await db.query(
      `SELECT COUNT(*) AS total FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.entidad_id
       ${where}`,
      params
    );

    const totalPaginas = Math.ceil(conteo.total / limite);

    // 📋 Datos
    const [auditoria] = await db.query(
      `
      SELECT
        a.id,
        a.fecha,
        admin.nombre AS admin,
        a.accion,
        u.nombre AS usuario_afectado,
        a.antes_json,
        a.despues_json
      FROM auditoria a
      LEFT JOIN usuarios admin ON admin.id = a.usuario_id
      LEFT JOIN usuarios u ON u.id = a.entidad_id
      ${where}
      ORDER BY a.fecha DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limite, offset]
    );

    // 🖼️ Logo
    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    // 🔹 Acciones disponibles (para el combo)
    const [acciones] = await db.query(`
      SELECT DISTINCT accion
      FROM auditoria
      WHERE entidad = 'usuarios'
      ORDER BY accion
    `);

    res.render("admin/auditoria_usuarios", {
      auditoria,
      acciones,
      filtros,          
      pagina,
      totalPaginas,
      usuarioSesion: req.session.usuario,
      logo
    });

  } catch (error) {
    console.error("❌ Error auditoría usuarios:", error);
    res.status(500).send("Error cargando auditoría de usuarios");
  }
});

/* ===========================================================
   📋 PANEL DE AUDITORÍAS
   =========================================================== */
router.get("/auditorias", verificarAdmin, async (req, res) => {
  try {
    // Obtener logo institucional (OBLIGATORIO para encabezado universal)
    const [conf] = await db.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/auditorias", {
      usuarioSesion: req.session.usuario,
      logo
    });

  } catch (error) {
    console.error("❌ Error cargando panel de auditorías:", error);
    res.status(500).send("Error cargando panel de auditorías");
  }
});

/* ===========================================================
   🎫 AUDITORÍA DE TICKETS (CON FILTROS + PAGINACIÓN)
   =========================================================== */
router.get("/auditoria-tickets", verificarAdmin, async (req, res) => {
  try {
    const limpiar = v => (v && v.trim() !== "" ? v.trim() : null);

    const estado = limpiar(req.query.estado);
    const tecnico_id = limpiar(req.query.tecnico_id);
    const ticket_id = limpiar(req.query.ticket_id);
    const fecha_desde = limpiar(req.query.fecha_desde);
    const fecha_hasta = limpiar(req.query.fecha_hasta);

    const pagina = parseInt(req.query.pagina) || 1;
    const limite = 10;
    const offset = (pagina - 1) * limite;

    let where = "WHERE a.entidad = 'tickets'";
    const params = [];

    if (estado) {
      where += " AND JSON_EXTRACT(a.despues_json, '$.estado') = ?";
      params.push(estado);
    }

    if (ticket_id) {
      where += " AND a.entidad_id = ?";
      params.push(ticket_id);
    }

    if (tecnico_id) {
      where += " AND JSON_EXTRACT(a.despues_json, '$.tecnico_id') = ?";
      params.push(tecnico_id);
    }

    if (fecha_desde) {
      where += " AND DATE(a.fecha) >= ?";
      params.push(fecha_desde);
    }

    if (fecha_hasta) {
      where += " AND DATE(a.fecha) <= ?";
      params.push(fecha_hasta);
    }

    // 🔢 Total registros
    const [[conteo]] = await db.query(
      `SELECT COUNT(*) AS total FROM auditoria a ${where}`,
      params
    );

    const totalPaginas = Math.ceil(conteo.total / limite);

    // 📄 Datos
    const [auditoria] = await db.query(
      `
      SELECT
        a.id,
        a.fecha,
        admin.nombre AS admin,
        a.accion,
        a.entidad_id AS ticket_id,
        a.antes_json,
        a.despues_json,
        ta.nombre AS tecnico_antes,
        td.nombre AS tecnico_despues
      FROM auditoria a
      LEFT JOIN usuarios admin ON admin.id = a.usuario_id
      LEFT JOIN usuarios ta ON ta.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(a.antes_json,'$.tecnico_id')) AS UNSIGNED)
      LEFT JOIN usuarios td ON td.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(a.despues_json,'$.tecnico_id')) AS UNSIGNED)
      ${where}
      ORDER BY a.fecha DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limite, offset]
    );

    const [tecnicos] = await db.query(`
      SELECT id, nombre
      FROM usuarios
      WHERE LOWER(rol) IN ('tecnico','técnico')
      ORDER BY nombre
    `);

    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render("admin/auditoria_tickets", {
      auditoria,
      tecnicos,
      filtros: { estado, tecnico_id, ticket_id, fecha_desde, fecha_hasta },
      pagina,
      totalPaginas,
      usuarioSesion: req.session.usuario,
      logo
    });

  } catch (error) {
    console.error("❌ Error auditoría tickets:", error);
    res.status(500).send("Error cargando auditoría de tickets");
  }
});

/* ===========================================================
   📤 EXPORTAR ROUTER
   =========================================================== */
export default router;

// ===========================================================
// FUNCIÓN: Obtener estadísticas por año
// ===========================================================
async function obtenerEstadisticasPorAno(anio) {

  // POR TÉCNICO (la tabla correcta es usuarios)
  const [porTecnico] = await db.query(`
    SELECT 
      COALESCE(u.nombre, 'Sin asignar') AS tecnico,
      COUNT(*) AS total
    FROM tickets k
    LEFT JOIN usuarios u ON k.tecnico_id = u.id AND u.rol = 'Técnico'
    WHERE YEAR(k.fecha_creacion) = ?
    GROUP BY tecnico
    ORDER BY tecnico;
  `, [anio]);

  // POR ESTADO
  const [porEstado] = await db.query(`
    SELECT 
      estado,
      COUNT(*) AS total
    FROM tickets
    WHERE YEAR(fecha_creacion) = ?
    GROUP BY estado
    ORDER BY estado;
  `, [anio]);

  // POR MES
  const [porMes] = await db.query(`
    SELECT 
      MONTH(fecha_creacion) AS mes,
      COUNT(*) AS total
    FROM tickets
    WHERE YEAR(fecha_creacion) = ?
    GROUP BY mes
    ORDER BY mes;
  `, [anio]);

  // Construcción array de meses 1–12
  const meses = new Array(12).fill(0);
  porMes.forEach(r => {
    meses[r.mes - 1] = r.total;
  });

  return {
    tecnicos: porTecnico,
    estados: porEstado,
    meses
  };
}

// ========================
// 📊 VISTA DE ESTADÍSTICAS
// ========================

router.get("/estadisticas", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const compare = req.query.compare || "";

    // 🔹 Cargar datos del sistema (incluye logo)
    const [configRows] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const configuracion = configRows[0] || {};

    // 🔹 Datos del año principal
    const datosYear = await obtenerEstadisticasPorAno(year);

    // 🔹 Datos del año comparativo
    let datosCompare = null;
    if (compare !== "") {
      datosCompare = await obtenerEstadisticasPorAno(compare);
    }

    res.render("admin/estadisticas", {
      year,
      compare,
      usuarioSesion: req.session.usuario,
      datosYear,
      datosCompare,
      logo: configuracion.logo || null
    });

  } catch (error) {
    console.error("Error cargando estadísticas:", error);
    res.status(500).send("Error en estadísticas");
  }
});

// ==============================
// 📊 API → Datos del Dashboard (Formato compatible con frontend)
// ==============================
router.get("/estadisticas/data", verificarAdmin, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const compare = req.query.compare || "";

    // =======================
    // FUNCIÓN HELPER
    // =======================
    async function obtenerDatos(anio) {
      // Tickets por técnico
      const [porTecnico] = await db.query(`
        SELECT 
          COALESCE(u.nombre, 'Sin técnico') AS tecnico, 
          COUNT(*) AS total
        FROM tickets t
        LEFT JOIN usuarios u ON u.id = t.tecnico_id
        WHERE YEAR(t.fecha_creacion) = ?
        GROUP BY tecnico
        ORDER BY tecnico;
      `, [anio]);

      // Tickets por estado
      const [porEstado] = await db.query(`
        SELECT estado, COUNT(*) AS total
        FROM tickets
        WHERE YEAR(fecha_creacion) = ?
        GROUP BY estado
        ORDER BY estado;
      `, [anio]);

      // Tickets por mes (llenar array 12)
      const [porMesRaw] = await db.query(`
        SELECT MONTH(fecha_creacion) AS mes, COUNT(*) AS total
        FROM tickets
        WHERE YEAR(fecha_creacion) = ?
        GROUP BY mes
        ORDER BY mes;
      `, [anio]);

      const porMes = new Array(12).fill(0);
      porMesRaw.forEach(r => {
        porMes[r.mes - 1] = r.total;
      });

      return {
        tecnicos: porTecnico,
        estados: porEstado,
        meses: porMes
      };
    }

    // =======================
    // OBTENER DATOS AÑO PRINCIPAL
    // =======================
    const datosYear = await obtenerDatos(year);

    // =======================
    // OBTENER DATOS DEL AÑO A COMPARAR
    // =======================
    let datosCompare = null;
    if (compare !== "") {
      datosCompare = await obtenerDatos(compare);
    }

    // =======================
    // NUEVA GRÁFICA → Técnico vs Mes
    // =======================
    const [porTecnicoMes] = await db.query(`
      SELECT 
        MONTH(t.fecha_creacion) AS mes,
        COALESCE(u.nombre, 'Sin técnico') AS tecnico,
        COUNT(*) AS total
      FROM tickets t
      LEFT JOIN usuarios u ON u.id = t.tecnico_id
      WHERE YEAR(t.fecha_creacion) = ?
      GROUP BY mes, tecnico
      ORDER BY mes, tecnico;
    `, [year]);

    // =======================
    // RESPUESTA FINAL
    // =======================
    res.json({
      year: datosYear,
      compare: datosCompare,
      porTecnicoMes
    });

  } catch (error) {
    console.error("❌ Error en /estadisticas/data:", error);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }

});
