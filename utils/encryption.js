// utils/encryption.js
import crypto from "crypto";

const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
  console.warn(
    "⚠️ SECRET_KEY no está definida en el archivo .env. " +
    "El cifrado de contraseñas SMTP no funcionará correctamente."
  );
}

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16; // bytes

function getKey() {
  // Aseguramos una key de 32 bytes para AES-256
  return crypto.createHash("sha256").update(String(SECRET_KEY || "")).digest();
}

/**
 * Cifra un texto plano (utf8) y devuelve: ivBase64:cipherBase64
 */
export function cifrarTexto(textoPlano) {
  if (!textoPlano) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(textoPlano, "utf8", "base64");
  encrypted += cipher.final("base64");

  const ivBase64 = iv.toString("base64");
  return `${ivBase64}:${encrypted}`;
}

/**
 * Descifra un texto cifrado en formato ivBase64:cipherBase64
 */
export function descifrarTexto(textoCifrado) {
  try {
    if (!textoCifrado) return "";
    const key = getKey();
    const [ivBase64, encrypted] = textoCifrado.split(":");
    if (!ivBase64 || !encrypted) return "";

    const iv = Buffer.from(ivBase64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("❌ Error al descifrar texto:", err.message);
    return "";
  }
}
