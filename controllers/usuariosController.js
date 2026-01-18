// ==========================================
// CONTROLADOR DE USUARIOS (controllers/usuariosController.js)
// ==========================================
import bcrypt from 'bcrypt';
import db from '../models/db.js';

// ==========================================
// 📋 Listar todos los usuarios
// ==========================================
export const listarUsuarios = async (req, res) => {
  try {
    const [usuarios] = await db.query('SELECT * FROM usuarios ORDER BY id ASC');

    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render('admin/admin_usuarios', {
      titulo: 'Gestión de Usuarios',
      usuarioSesion: req.session.usuario,
      usuarios,
      logo
    });
  } catch (error) {
    console.error('❌ Error al listar usuarios:', error);
    res.status(500).send('Error al listar usuarios');
  }
};

// ==========================================
// ➕ Crear nuevo usuario
// ==========================================
export const crearUsuario = async (req, res) => {
  const { nombre, correo, contrasena, rol } = req.body;

  try {
    // Evitar duplicados por correo
    const [existe] = await db.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
    if (existe.length > 0) {
      console.log('⚠️ El correo ya existe:', correo);
      return res.status(400).send('El correo ya está registrado');
    }

    // Encriptar contraseña
    const hashed = await bcrypt.hash(contrasena, 10);

    await db.query(
      'INSERT INTO usuarios (nombre, correo, contrasena, rol) VALUES (?, ?, ?, ?)',
      [nombre, correo, hashed, rol]
    );

    console.log(`✅ Usuario creado correctamente: ${nombre} (${rol})`);
    res.redirect('/admin/usuarios');
  } catch (error) {
    console.error('❌ Error al crear usuario:', error);
    res.status(500).send('Error al crear usuario');
  }
};

// ==========================================
// ✏️ Mostrar formulario de edición
// ==========================================
export const formEditarUsuario = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query('SELECT * FROM usuarios WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('Usuario no encontrado');

    const [conf] = await db.query("SELECT logo FROM configuracion_general LIMIT 1");
    const logo = conf.length ? conf[0].logo : null;

    res.render('admin/editar_usuario', {
      titulo: 'Editar Usuario',
      usuarioSesion: req.session.usuario,
      usuarioEditar: rows[0],
      logo
    });
  } catch (error) {
    console.error('❌ Error al cargar usuario:', error);
    res.status(500).send('Error al cargar usuario');
  }
};

// ==========================================
// 💾 Actualizar usuario
// ==========================================
export const actualizarUsuario = async (req, res) => {
  const { id } = req.params;
  const { nombre, correo, contrasena, rol } = req.body;

  try {
    let query = 'UPDATE usuarios SET nombre = ?, correo = ?, rol = ?';
    const params = [nombre, correo, rol];

    // Si se ingresó una nueva contraseña, se encripta
    if (contrasena && contrasena.trim() !== '') {
      const hashed = await bcrypt.hash(contrasena, 10);
      query += ', contrasena = ?';
      params.push(hashed);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.query(query, params);

    console.log(`✅ Usuario actualizado correctamente (ID ${id})`);
    res.redirect('/admin/usuarios');
  } catch (error) {
    console.error('❌ Error al actualizar usuario:', error);
    res.status(500).send('Error al actualizar usuario');
  }
};

// ==========================================
// 🗑️ Eliminar usuario
// ==========================================
export const eliminarUsuario = async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM usuarios WHERE id = ?', [id]);
    console.log(`🗑️ Usuario eliminado (ID ${id})`);
    res.redirect('/admin/usuarios');
  } catch (error) {
    console.error('❌ Error al eliminar usuario:', error);
    res.status(500).send('Error al eliminar usuario');
  }
};
