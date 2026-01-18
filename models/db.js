import mysql from "mysql2/promise";

let connection = null;

if (process.env.DB_HOST && process.env.DB_HOST !== "test") {
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
    });

    console.log("✅ Conectado a MySQL");
  } catch (error) {
    console.error("❌ Error conectando a MySQL:", error.message);
  }
} else {
  console.warn("⚠️ MySQL deshabilitado (modo sin BD)");
}

export default connection;
