// utils/mailer.js
import nodemailer from "nodemailer";
import db from "../models/db.js";
import { descifrarTexto } from "../utils/encryption.js";
import path from "path";
import fs from "fs";

/* ===========================================================
   🔧 Leer configuración SMTP + logo desde la BD
   =========================================================== */
async function obtenerConfiguracionSMTP() {
  const [rows] = await db.query(`
    SELECT 
      smtp_correo,
      smtp_password,
      smtp_host,
      smtp_seguridad,
      smtp_port,
      nombre_institucion,
      logo
    FROM configuracion_general
    LIMIT 1
  `);

  if (!rows.length) {
    throw new Error("No hay configuración SMTP registrada.");
  }

  return rows[0];
}

/* ===========================================================
   📝 Detectar tipo real del archivo por firma (PNG/JPG/WEBP)
   =========================================================== */
function detectarTipoArchivo(buffer) {
  // PNG
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return { ext: "png", mime: "image/png" };
  }

  // JPG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  // WEBP (firma RIFF)
  if (buffer.slice(0, 4).equals(Buffer.from("RIFF"))) {
    return { ext: "webp", mime: "image/webp" };
  }

  // Default
  return { ext: "png", mime: "image/png" };
}

/* ===========================================================
   🧩 Generar adjunto CID del logo para Gmail
   =========================================================== */
function construirAdjuntoLogo(config) {
  if (!config.logo) return { cid: null, attachments: [] };

  const uploadsPath = path.join(process.cwd(), "uploads");
  const baseName = config.logo;
  const originalPath = path.join(uploadsPath, baseName);

  if (!fs.existsSync(originalPath)) {
    console.error("⚠ Logo no encontrado:", originalPath);
    return { cid: null, attachments: [] };
  }

  // Leer bytes del logo
  const buffer = fs.readFileSync(originalPath);
  const { ext, mime } = detectarTipoArchivo(buffer);

  const finalName = `${baseName}.${ext}`;
  const finalPath = path.join(uploadsPath, finalName);

  // Crear archivo con extensión si no existe
  if (!fs.existsSync(finalPath)) {
    fs.copyFileSync(originalPath, finalPath);
  }

  const cid = "logo-soporte-epn@cid";

  return {
    cid,
    attachments: [
      {
        filename: `logo.${ext}`,
        path: finalPath,
        cid,
        contentType: mime,
      },
    ],
  };
}

/* ===========================================================
   📨 Crear transporter SMTP
   =========================================================== */
function crearTransporterDesdeConfig(config) {
  const passReal = descifrarTexto(config.smtp_password);

  const transporter = nodemailer.createTransport({
    host: config.smtp_host,
    port: Number(config.smtp_port),
    secure: config.smtp_seguridad === "ssl",
    auth: {
      user: config.smtp_correo,
      pass: passReal,
    },
  });

  return {
    transporter,
    smtp_correo: config.smtp_correo,
    nombreFrom: config.nombre_institucion || "Soporte Técnico EPN",
  };
}

/* ===========================================================
   📧 FUNCIÓN GENÉRICA PARA ENVIAR CORREOS (con logo embebido)
   =========================================================== */
export async function enviarCorreo(destino, asunto, mensajeHTML) {
  try {
    const config = await obtenerConfiguracionSMTP();
    const { transporter, smtp_correo, nombreFrom } =
      crearTransporterDesdeConfig(config);

    const { cid: logoCid, attachments } = construirAdjuntoLogo(config);

    const htmlConLogo = `
      <div style="font-family:Arial; color:#333;">
        ${logoCid ? `<div style="text-align:center;margin-bottom:15px;">
            <img src="cid:${logoCid}" style="max-width:160px;height:auto;">
        </div>` : ""}
        ${mensajeHTML}
      </div>
    `;

    await transporter.sendMail({
      from: `"${nombreFrom}" <${smtp_correo}>`,
      to: destino,
      subject: asunto,
      html: htmlConLogo,
      attachments,
    });

    console.log(`📧 Correo enviado correctamente a ${destino}`);
  } catch (error) {
    console.error("❌ Error enviando correo:", error.message);
  }
}

/* ===========================================================
   👤 CORREO DE BIENVENIDA (con logo embebido)
   =========================================================== */
export async function enviarCorreoNuevoUsuario(nombre, correo, rol) {
  try {
    const config = await obtenerConfiguracionSMTP();
    const { transporter, smtp_correo, nombreFrom } =
      crearTransporterDesdeConfig(config);

    const { cid: logoCid, attachments } = construirAdjuntoLogo(config);

    const html = `
      <div style="font-family:Arial; color:#333;">
        ${logoCid ? `<div style="text-align:center;margin-bottom:15px;">
            <img src="cid:${logoCid}" style="max-width:160px;height:auto;">
        </div>` : ""}

        <h2>👋 ¡Hola ${nombre}!</h2>
        <p>Tu cuenta ha sido creada como <strong>${rol}</strong>.</p>

        <p>Puedes ingresar aquí:</p>
        <a href="http://localhost:3000/login"
           style="background:#007bff;color:white;padding:12px 18px;border-radius:5px;text-decoration:none;">
           Ingresar al sistema
        </a>

        <br><br>
        <p>Si no solicitaste este acceso, ignora este mensaje.</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"${nombreFrom}" <${smtp_correo}>`,
      to: correo,
      subject: "¡Bienvenido al Sistema de Soporte!",
      html,
      attachments,
    });

    console.log(`✅ Correo de bienvenida enviado a ${correo}`);
  } catch (error) {
    console.error("❌ Error al enviar correo de nuevo usuario:", error.message);
  }
}
