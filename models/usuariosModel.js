// ==========================================
// MODELO DE USUARIOS (models/usuariosModel.js)
// ==========================================
// Este archivo contiene las funciones CRUD para gestionar
// los usuarios del sistema (técnicos y administradores).

import db from './db.js';
import bcrypt from 'bcrypt';

// ==========================================
// OBTENER USUARIO POR CORREO (para login)
// ==========================================
export const obtenerUsuarioPorCorreo = async (correo) => {
  try {
    const [rows] = await db.query('SELECT * FROM usuarios WHERE correo = ?', [correo]);
    return rows[0];
  } catch (error) {
    console.error('❌ Error al obtener usuario por correo:', error);
    throw error;
  }
};

// ==========================================
// OBTENER TODOS LOS USUARIOS
// ==========================================
export const obtenerUsuarios = async () => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, correo, rol FROM usuarios ORDER BY id ASC'
    );
    return rows;
  } catch (error) {
    console.error('❌ Error al obtener usuarios:', error);
    throw error;
  }
};

// ==========================================
// OBTENER USUARIO POR ID
// ==========================================
export const obtenerUsuarioPorId = async (id) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, correo, rol FROM usuarios WHERE id = ?',
      [id]
    );
    return rows[0];
  } catch (error) {
    console.error('❌ Error al obtener usuario por ID:', error);
    throw error;
  }
};

// ==========================================
// CREAR NUEVO USUARIO
// ==========================================
export const crearUsuario = async (nombre, correo, contrasena, rol) => {
  try {
    const hashedPassword = await bcrypt.hash(contrasena, 10);
    await db.query(
      'INSERT INTO usuarios (nombre, correo, contrasena, rol) VALUES (?, ?, ?, ?)',
      [nombre, correo, hashedPassword, rol]
    );
    return true;
  } catch (error) {
    console.error('❌ Error al crear usuario:', error);
    throw error;
  }
};

// ==========================================
// ACTUALIZAR USUARIO
// ==========================================
export const actualizarUsuario = async (id, nombre, correo, contrasena, rol) => {
  try {
    if (contrasena && contrasena.trim() !== '') {
      const hashedPassword = await bcrypt.hash(contrasena, 10);
      await db.query(
        'UPDATE usuarios SET nombre = ?, correo = ?, contrasena = ?, rol = ? WHERE id = ?',
        [nombre, correo, hashedPassword, rol, id]
      );
    } else {
      await db.query(
        'UPDATE usuarios SET nombre = ?, correo = ?, rol = ? WHERE id = ?',
        [nombre, correo, rol, id]
      );
    }
    return true;
  } catch (error) {
    console.error('❌ Error al actualizar usuario:', error);
    throw error;
  }
};

// ==========================================
// ELIMINAR USUARIO
// ==========================================
export const eliminarUsuario = async (id) => {
  try {
    await db.query('DELETE FROM usuarios WHERE id = ?', [id]);
    return true;
  } catch (error) {
    console.error('❌ Error al eliminar usuario:', error);
    throw error;
  }
};
