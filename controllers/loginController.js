// controllers/loginController.js
import bcrypt from "bcrypt";
import { obtenerUsuarioPorCorreo } from "../models/usuariosModel.js";
import pool from "../models/db.js"; // Conexión a la BD

// ==========================================
// MOSTRAR FORMULARIO DE LOGIN
// ==========================================
export const mostrarLogin = async (req, res) => {
  try {
    const [conf] = await pool.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    res.render("login", {
      title: "Iniciar sesión",
      error: null,
      logo
    });
  } catch (err) {
    console.error("❌ Error cargando logo en login:", err);

    res.render("login", {
      title: "Iniciar sesión",
      error: null,
      logo: null
    });
  }
};

// ==========================================
// PROCESAR LOGIN + 2FA
// ==========================================
export const procesarLogin = async (req, res) => {
  try {
    const { correo, contrasena } = req.body;

    const [conf] = await pool.query(
      "SELECT logo FROM configuracion_general LIMIT 1"
    );
    const logo = conf.length ? conf[0].logo : null;

    if (!correo || !contrasena) {
      return res.render("login", {
        title: "Iniciar sesión",
        error: "Correo y contraseña son obligatorios",
        logo
      });
    }

    const usuario = await obtenerUsuarioPorCorreo(correo);
    console.log("🧠 Usuario encontrado:", usuario);

    if (!usuario) {
      return res.render("login", {
        title: "Iniciar sesión",
        error: "Usuario no encontrado",
        logo
      });
    }

    const hash = usuario.password || usuario.contrasena;

    if (!hash) {
      console.error("⚠️ El usuario no tiene contraseña encriptada:", usuario);
      return res.render("login", {
        title: "Iniciar sesión",
        error: "Error interno: el usuario no tiene contraseña configurada",
        logo
      });
    }

    const coincide = await bcrypt.compare(contrasena, hash);
    if (!coincide) {
      return res.render("login", {
        title: "Iniciar sesión",
        error: "Contraseña incorrecta",
        logo
      });
    }

    // ==========================================
    // 1️⃣ SI NO TIENE 2FA ACTIVADO → FORZAR ACTIVACIÓN
    //    (PARA TODOS LOS USUARIOS)
    // ==========================================
    if (usuario.twofa_enabled === 0) {
      console.log("⚠ Usuario sin 2FA, redirigiendo a /activar-2fa");

      // Guardamos al usuario en la sesión normal
      req.session.usuario = {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol: usuario.rol,
        twofa_enabled: false,
        twofa_secret: usuario.twofa_secret
      };

      // Marcamos que AÚN NO ha validado 2FA
      req.session.twofaValidado = false;

      return req.session.save(() => {
        return res.redirect("/activar-2fa");
      });
    }

    // ==========================================
    // 2️⃣ SI YA TIENE 2FA ACTIVADO → PEDIR CÓDIGO
    // ==========================================
    if (usuario.twofa_enabled === 1) {
      console.log("🔐 Usuario con 2FA activo, solicitando código...");

      // Usuario temporal para verificar el código TOTP
      req.session.tempUser = {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol: usuario.rol,
        twofa_secret: usuario.twofa_secret
      };

      return req.session.save(() => {
        return res.redirect("/login/verificar-2fa");
      });
    }

    // ==========================================
    // 3️⃣ (CASO RARO) LOGIN SIN 2FA
    // ==========================================
    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      twofa_enabled: usuario.twofa_enabled === 1,
      twofa_secret: usuario.twofa_secret
    };

    await pool.query(
      "UPDATE usuarios SET fecha_acceso = NOW() WHERE id = ?",
      [usuario.id]
    );

    const rol = usuario.rol ? usuario.rol.toLowerCase() : "";
    console.log("🔄 Rol detectado:", rol);

    req.session.save(() => {
      console.log("✅ Sesión guardada correctamente:", req.session.usuario);

      if (rol === "administrador" || rol === "admin") {
        return res.redirect("/admin");
      } else if (rol === "tecnico" || rol === "técnico") {
        return res.redirect("/tecnico");
      } else {
        return res.redirect("/usuarios");
      }
    });
  } catch (error) {
    console.error("❌ Error en login:", error);

    let logo = null;
    try {
      const [conf] = await pool.query(
        "SELECT logo FROM configuracion_general LIMIT 1"
      );
      logo = conf.length ? conf[0].logo : null;
    } catch (e) {
      console.error(
        "⚠️ Error adicional obteniendo logo en catch de login:",
        e
      );
    }

    res.render("login", {
      title: "Iniciar sesión",
      error: "Error interno del servidor",
      logo
    });
  }
};

// ==========================================
// CERRAR SESIÓN
// ==========================================
export const cerrarSesion = (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
};

// ==========================================
// VERIFICAR CÓDIGO 2FA (TOTP)
// ==========================================
import speakeasy from "speakeasy";

export const verificar2FA = async (req, res) => {
  try {
    const codigo = req.body.codigo;

    // Usuario temporal guardado en el login
    const usuario = req.session.tempUser;

    if (!usuario) {
      return res.redirect("/login");
    }

    // 1️⃣ Verificar código TOTP
    const valido = speakeasy.totp.verify({
      secret: usuario.twofa_secret,
      encoding: "base32",
      token: codigo,
      window: 1
    });

    if (!valido) {
      return res.render("verificar_2fa", {
        error: "Código incorrecto"
      });
    }

    // 2️⃣ Código correcto → activar sesión real
    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol,
      twofa_enabled: true,
      twofa_secret: usuario.twofa_secret
    };

    req.session.twofaValidado = true;

    // Eliminar usuario temporal
    delete req.session.tempUser;

    // 3️⃣ Redirigir según rol
    if (usuario.rol === "admin" || usuario.rol === "administrador") {
      return res.redirect("/admin");
    }

    if (usuario.rol === "tecnico" || usuario.rol === "técnico") {
      return res.redirect("/tecnico");
    }

    return res.redirect("/usuarios");

  } catch (error) {
    console.error("❌ Error verificando 2FA:", error);
    res.render("verificar_2fa", {
      error: "Error interno al verificar el código"
    });
  }
};
