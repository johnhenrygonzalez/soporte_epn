// middleware/requiere2FA.js
export default function requiere2FA(req, res, next) {

  // 1️⃣ Si no hay sesión → login
  if (!req.session || !req.session.usuario) {
    return res.redirect("/login");
  }

  const user = req.session.usuario;

  // 2️⃣ Si NO tiene 2FA activado → permitir rutas normales
  if (!user.twofa_enabled) {
    return next();
  }

  // 3️⃣ Si tiene 2FA activado PERO no validado en esta sesión
  if (!req.session.twofaValidado) {
    return res.redirect("/login/verificar-2fa");
  }

  // 4️⃣ Todo OK
  next();
}
