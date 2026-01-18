import express from 'express';
import * as usuariosController from '../controllers/usuariosController.js';
// import { requiere2FA } from "../middleware/requiere2FA.js";

const router = express.Router();

// ✅ Middleware para verificar si hay sesión activa y rol permitido
function verificarSesionYRol(req, res, next) {
  if (!req.session.usuario) {
    return res.redirect('/login'); // si no hay sesión, vuelve al login
  }

  // ejemplo: si el usuario es técnico, no puede entrar a rutas de administración
  if (req.session.usuario.rol === 'tecnico') {
    return res.redirect('/tecnico'); // redirige al panel de técnicos
  }

  // si pasa las verificaciones, sigue
  next();
}

// aplica el middleware a todas las rutas de usuarios
router.use(verificarSesionYRol);

// Rutas de usuarios (solo accesibles por admin)
router.get('/', usuariosController.listarUsuarios);

export default router;
