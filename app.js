import express from "express";
import session from "express-session";
import path from "path";
import dotenv from "dotenv";

import ticketsRoutes from "./routes/ticketsroutes.js";
import usuariosRoutes from "./routes/usuariosRoutes.js";
import loginRoutes from "./routes/loginRoutes.js";
import adminRoutes from "./routes/admin.js";
import tecnicoRoutes from "./routes/tecnico.js";
import activar2faRoutes from "./routes/activar2fa.js";

import requiere2FA from "./middleware/requiere2FA.js";
import expressLayouts from "express-ejs-layouts";

dotenv.config();
const app = express();

// ==========================================
// CONFIGURACIÓN GENERAL
// ==========================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ==========================================
// SESSION — DEBE IR ANTES DE CUALQUIER RUTA
// ==========================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback_local",
    resave: false,
    saveUninitialized: true,
  })
);

// ==========================================
// MOTOR DE PLANTILLAS Y ARCHIVOS ESTÁTICOS
// ==========================================
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(express.static(path.join(process.cwd(), "public")));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use(expressLayouts);
app.set("layout", "layout");

// ==========================================
// RUTAS PÚBLICAS (SIN 2FA)
// ==========================================
app.use("/login", loginRoutes);
app.use("/activar-2fa", activar2faRoutes);

// ==========================================
// RUTAS PROTEGIDAS (REQ 2FA)
// ==========================================
//app.use("/admin", requiere2FA, adminRoutes);
app.use("/admin", adminRoutes); ///// temporal/////////////////////////////////////////
app.use("/tecnico", requiere2FA, tecnicoRoutes);
app.use("/usuarios", requiere2FA, usuariosRoutes);

// RUTA PRINCIPAL (Opcional)
app.use("/", ticketsRoutes);

// ==========================================
// CERRAR SESIÓN
// ==========================================
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ==========================================
// 404
// ==========================================
app.use((req, res) => {
  res.status(404).render("404", { mensaje: "Página no encontrada" });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

