require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');

// Ejemplo para generar hash (solo para verificación en consola)
bcrypt.hash('hola', 10).then(hash => {
  console.log("Hash de ejemplo para contraseña hola:", hash);
});

const app = express();
app.use(express.json());
app.use(cors());

// 📌 Clave JWT (puedes moverla a .env si lo prefieres)
const SECRET_KEY = 'secreto_super_seguro';

// 📌 Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Ej: postgresql://usuario:password@host:puerto/db
  ssl: process.env.DATABASE_SSL ? { rejectUnauthorized: false } : false
});
console.log('📌 DATABASE_URL:', process.env.DATABASE_URL);

// 📌 Verificar conexión con PostgreSQL
(async () => {
  try {
    const client = await pool.connect();
    console.log('📦 Conectado a PostgreSQL');
    client.release();
  } catch (error) {
    console.error('❌ Error de conexión a PostgreSQL:', error);
    process.exit(1);
  }
})();

// 🔹 Configuración de Nodemailer para enviar correos vía Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // EMAIL_USER en .env
    pass: process.env.EMAIL_PASS  // EMAIL_PASS en .env
  }
});

// Función auxiliar para enviar correos
async function enviarCorreo(opciones) {
  try {
    await transporter.sendMail(opciones);
    console.log("✉️ Correo enviado correctamente a:", opciones.to);
  } catch (error) {
    console.error("❌ Error al enviar correo:", error);
  }
}

// ────────────────────────────────────────────────
// CRON: Tarea programada para enviar recordatorio 48 horas antes de la cita
// ────────────────────────────────────────────────
cron.schedule('0 9 * * *', async () => {
  console.log("⏰ Ejecutando tarea de recordatorio 48hs...");
  try {
    const hoy = new Date();
    const fechaRecordatorio = new Date(hoy);
    fechaRecordatorio.setDate(hoy.getDate() + 2); // 48 horas antes
    const yyyy = fechaRecordatorio.getFullYear();
    const mm = String(fechaRecordatorio.getMonth() + 1).padStart(2, '0');
    const dd = String(fechaRecordatorio.getDate()).padStart(2, '0');
    const fechaTarget = `${yyyy}-${mm}-${dd}`;

    // Buscar citas abiertas para la fecha objetivo
    const citas = await pool.query(`
      SELECT 
        c.id AS cita_id, 
        c.fecha, 
        c.hora, 
        p.email, 
        p.nombre AS paciente_nombre, 
        cl.telefono AS cliente_telefono,
        cl.nombre AS cliente_nombre
      FROM citas c
      JOIN pacientes p ON c.paciente_id = p.id
      JOIN cliente cl ON p.cliente_id = cl.id
      WHERE to_char(c.fecha, 'YYYY-MM-DD') = $1 AND c.estado = 'abierto'
    `, [fechaTarget]);

    for (const cita of citas.rows) {
      const { fecha, hora, email, paciente_nombre, cliente_telefono, cliente_nombre } = cita;
      const fechaStr = fecha.toString().split('T')[0];
      const telStr = String(cliente_telefono).trim();
      const formattedPhone = telStr.startsWith('0') ? `598${telStr.slice(1)}` : telStr;
      const mensajeWa = `En caso de no poder asistir a la cita, anula aquí:\n\nPaciente: ${paciente_nombre}\nFecha: ${fechaStr}\nHora: ${hora} hs\nCliente: ${cliente_nombre}`;
      const waLink = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(mensajeWa)}`;
      
      const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Recordatorio de Cita</title>
        <style>
          body { 
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
            background-color: #f5f5f5; 
            color: #333; 
            margin: 0; 
            padding: 0; 
          }
          .container { 
            max-width: 600px; 
            margin: 40px auto; 
            background-color: #fff; 
            border-radius: 8px; 
            box-shadow: 0 2px 8px rgba(0,0,0,0.1); 
            overflow: hidden;
          }
          .header { 
            text-align: center; 
            padding: 25px; 
            background: linear-gradient(135deg, #1976d2, #2196f3);
            color: #fff;
          }
          .header h2 { margin: 0; font-size: 24px; }
          .content { padding: 20px 30px; }
          .content p { margin: 10px 0; font-size: 16px; }
          .details { margin-top: 25px; padding-top: 15px; border-top: 1px solid #ddd; }
          .details-item { margin-bottom: 10px; }
          .details-item span.label { font-weight: bold; color: #666; }
          .alert-text { text-align: center; font-size: 16px; font-weight: bold; color: #d32f2f; margin-top: 20px; }
          .btn-wa { display: block; width: 60%; margin: 15px auto 0; text-align: center; background-color: #d32f2f; color: #fff; padding: 14px 0; border-radius: 30px; font-weight: 700; text-decoration: none; transition: background 0.3s ease; }
          .btn-wa:hover { background-color: #b71c1c; }
          .footer { text-align: center; font-size: 14px; color: #777; padding: 15px; border-top: 1px solid #eee; background-color: #f9f9f9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Recordatorio de Cita</h2>
          </div>
          <div class="content">
            <p><strong>Paciente:</strong> ${paciente_nombre}</p>
            <div class="details">
              <div class="details-item">
                <span class="label">Fecha:</span> ${fechaStr}
              </div>
              <div class="details-item">
                <span class="label">Hora:</span> ${hora} hs
              </div>
            </div>
            <div class="alert-text">En caso de no poder asistir a la cita ingresar aquí:</div>
            <a href="${waLink}" class="btn-wa">ANULAR CITA</a>
          </div>
          <div class="footer">
            <p>Gracias por confiar en nosotros.</p>
          </div>
        </div>
      </body>
      </html>
      `;
      
      await enviarCorreo({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Recordatorio: Tienes una cita en 48 horas',
        html
      });
    }
    console.log("✅ Recordatorios enviados:", citas.rows.length);
  } catch (error) {
    console.error("❌ Error al enviar recordatorios:", error);
  }
});

// ────────────────────────────────────────────────
// Middleware para verificar token (JWT)
// ────────────────────────────────────────────────
const verificarToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(" ")[1];
  if (!token) {
    return res.status(403).json({ error: 'Token requerido' });
  }
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    req.user = decoded; // { id: <user_id>, role: 'cliente' o 'owner' }
    next();
  });
};

// ────────────────────────────────────────────────
// LOGIN ENDPOINTS
// ────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { nombre, password } = req.body;
  try {
    console.log("🟡 Intento de login para cliente:", nombre);
    const result = await pool.query('SELECT * FROM cliente WHERE nombre = $1', [nombre]);
    if (result.rows.length === 0) {
      console.error("❌ Cliente no encontrado.");
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const usuario = result.rows[0];
    const isMatch = await bcrypt.compare(password, usuario.password_hash);
    if (!isMatch) {
      console.error("❌ Contraseña incorrecta.");
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const token = jwt.sign({ id: usuario.id, role: 'cliente' }, SECRET_KEY, { expiresIn: '8h' });
    console.log("✅ Token generado correctamente para cliente.");
    res.json({ message: 'Inicio de sesión exitoso', token });
  } catch (error) {
    console.error('❌ Error en el login de cliente:', error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

app.post('/api/owner/login', async (req, res) => {
  const { nombre, password } = req.body;
  try {
    console.log("🟡 Intento de login para owner:", nombre);
    const result = await pool.query('SELECT * FROM owner WHERE nombre = $1', [nombre]);
    if (result.rows.length === 0) {
      console.error("❌ Owner no encontrado.");
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const usuario = result.rows[0];
    const isMatch = await bcrypt.compare(password, usuario.password_hash);
    if (!isMatch) {
      console.error("❌ Contraseña incorrecta.");
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const token = jwt.sign({ id: usuario.id, role: 'owner' }, SECRET_KEY, { expiresIn: '8h' });
    console.log("✅ Token generado correctamente para owner.");
    res.json({ message: 'Inicio de sesión exitoso', token });
  } catch (error) {
    console.error('❌ Error en el login de owner:', error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// ────────────────────────────────────────────────
// ENDPOINTS PARA OWNER
// ────────────────────────────────────────────────
app.get('/api/owner/clientes/:id', verificarToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el owner puede ver el cliente.' });
  }
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM cliente WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al obtener cliente:", error);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

app.post('/api/clientes', verificarToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el owner puede crear clientes.' });
  }
  const { nombre, password, direccion, telefono, profesion } = req.body;
  if (!nombre || !password) {
    return res.status(400).json({ error: 'Nombre y contraseña son obligatorios' });
  }
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO cliente (nombre, password_hash, direccion, telefono, profesion) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nombre, password_hash, direccion, telefono, profesion]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al crear cliente:", error);
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

app.get('/api/owner/clientes', verificarToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el owner puede ver todos los clientes.' });
  }
  try {
    const result = await pool.query('SELECT * FROM cliente ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error al obtener clientes:", error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

app.delete('/api/clientes/:id', verificarToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el owner puede eliminar clientes.' });
  }
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM cliente WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json({ message: 'Cliente eliminado correctamente', cliente: result.rows[0] });
  } catch (error) {
    console.error("❌ Error al eliminar cliente:", error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
});

app.put('/api/clientes/:id', verificarToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el owner puede editar clientes.' });
  }
  const { id } = req.params;
  const { nombre, password, direccion, telefono, profesion } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  try {
    let query, values;
    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      query = `UPDATE cliente 
               SET nombre = $1, password_hash = $2, direccion = $3, telefono = $4, profesion = $5 
               WHERE id = $6 RETURNING *`;
      values = [nombre, password_hash, direccion, telefono, profesion, id];
    } else {
      query = `UPDATE cliente 
               SET nombre = $1, direccion = $2, telefono = $3, profesion = $4 
               WHERE id = $5 RETURNING *`;
      values = [nombre, direccion, telefono, profesion, id];
    }
    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al editar cliente:", error);
    res.status(500).json({ error: 'Error al editar cliente' });
  }
});

app.get('/api/owner/pacientes', verificarToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el owner puede ver todos los pacientes.' });
  }
  try {
    const pacientesResult = await pool.query('SELECT * FROM pacientes ORDER BY id DESC');
    const citasResult = await pool.query('SELECT * FROM citas');
    const pacientesConCitas = pacientesResult.rows.map((paciente) => {
      const citas = citasResult.rows.filter(c => c.paciente_id === paciente.id);
      return { ...paciente, citas };
    });
    res.json(pacientesConCitas);
  } catch (error) {
    console.error("❌ Error al obtener pacientes:", error);
    res.status(500).json({ error: "Error al obtener pacientes" });
  }
});

app.get('/api/owner/citas', verificarToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el owner puede ver todas las citas.' });
  }
  try {
    const citasResult = await pool.query(`
      SELECT c.*, p.nombre AS paciente, p.email, p.telefono, cl.nombre AS cliente
      FROM citas c
      JOIN pacientes p ON c.paciente_id = p.id
      JOIN cliente cl ON p.cliente_id = cl.id
      ORDER BY c.fecha DESC
    `);
    res.json(citasResult.rows);
  } catch (error) {
    console.error("❌ Error al obtener citas:", error);
    res.status(500).json({ error: "Error al obtener citas" });
  }
});

// ────────────────────────────────────────────────
// ENDPOINTS PARA CLIENTES - PACIENTES Y CITAS
// ────────────────────────────────────────────────
app.post('/api/pacientes', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden agregar pacientes.' });
  }
  const { nombre, email, telefono } = req.body;
  if (!nombre || !email || !telefono) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO pacientes (cliente_id, nombre, email, telefono) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, nombre, email, telefono]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al agregar paciente:", error);
    res.status(500).json({ error: 'Error al agregar paciente' });
  }
});

app.get('/api/pacientes', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden ver sus pacientes.' });
  }
  try {
    const pacientesResult = await pool.query(
      'SELECT * FROM pacientes WHERE cliente_id = $1 ORDER BY id DESC',
      [req.user.id]
    );
    const citasResult = await pool.query('SELECT * FROM citas');
    const pacientesConCitas = pacientesResult.rows.map((paciente) => {
      const citasAbiertas = citasResult.rows.filter(
        (c) => c.paciente_id === paciente.id && c.estado === 'abierto'
      );
      return { ...paciente, citas: citasAbiertas };
    });
    res.json(pacientesConCitas);
  } catch (error) {
    console.error("❌ Error al obtener pacientes:", error);
    res.status(500).json({ error: "Error al obtener pacientes" });
  }
});

app.get('/api/pacientes/:id', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden ver sus pacientes.' });
  }
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM pacientes WHERE id = $1 AND cliente_id = $2',
      [id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al obtener paciente:", error);
    res.status(500).json({ error: "Error al obtener paciente" });
  }
});

app.put('/api/pacientes/:id', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden actualizar sus pacientes.' });
  }
  const { id } = req.params;
  const { nombre, email, telefono } = req.body;
  if (!nombre || !email || !telefono) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  try {
    const result = await pool.query(
      'UPDATE pacientes SET nombre = $1, email = $2, telefono = $3 WHERE id = $4 AND cliente_id = $5 RETURNING *',
      [nombre, email, telefono, id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al actualizar paciente:", error);
    res.status(500).json({ error: 'Error al actualizar paciente' });
  }
});

app.delete('/api/pacientes/:id', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden eliminar sus pacientes.' });
  }
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM pacientes WHERE id = $1 AND cliente_id = $2 RETURNING *',
      [id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }
    res.json({ message: 'Paciente eliminado correctamente', paciente: result.rows[0] });
  } catch (error) {
    console.error("❌ Error al eliminar paciente:", error);
    res.status(500).json({ error: 'Error al eliminar paciente' });
  }
});

app.post('/api/citas', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden agendar citas.' });
  }
  const { paciente_id, fecha, hora, notas } = req.body;
  if (!paciente_id || !fecha || !hora) {
    return res.status(400).json({ error: 'Paciente, fecha y hora son obligatorios' });
  }
  try {
    const pacienteVerificado = await pool.query(
      'SELECT * FROM pacientes WHERE id = $1 AND cliente_id = $2',
      [paciente_id, req.user.id]
    );
    if (pacienteVerificado.rowCount === 0) {
      return res.status(403).json({ error: 'No tienes permisos para asignar una cita a este paciente' });
    }
    const citaExistente = await pool.query(
      'SELECT * FROM citas WHERE paciente_id = $1 AND estado = $2',
      [paciente_id, 'abierto']
    );
    if (citaExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El paciente ya tiene una cita pendiente' });
    }
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaCita = new Date(fecha);
    if (fechaCita <= hoy) {
      return res.status(400).json({ error: 'La cita debe ser agendada para un día posterior a hoy' });
    }
    const result = await pool.query(
      'INSERT INTO citas (paciente_id, fecha, hora, notas, asistio, estado) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [paciente_id, fecha, hora, notas || '', null, 'abierto']
    );
    const nuevaCita = result.rows[0];
    const pacienteResult = await pool.query(`
      SELECT p.email, p.nombre AS paciente_nombre, cl.nombre AS cliente_nombre, 
             cl.direccion, cl.telefono, cl.profesion 
      FROM pacientes p 
      JOIN cliente cl ON p.cliente_id = cl.id 
      WHERE p.id = $1
    `, [paciente_id]);
    if (pacienteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }
    const { email, paciente_nombre, cliente_nombre, direccion, telefono, profesion } = pacienteResult.rows[0];
    const fechaFormateada = (() => {
      const dateObj = new Date(fecha);
      const day = dateObj.getDate();
      const monthIndex = dateObj.getMonth();
      const year = dateObj.getFullYear();
      const meses = [
        'enero', 'febrero', 'marzo', 'abril',
        'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'
      ];
      return `${day} de ${meses[monthIndex]} del ${year}`;
    })();
    const htmlCorreo = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Cita agendada</title>
  <style>
    body, p, h2, h3 { margin: 0; padding: 0; }
    body { 
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
      background: #f9fafb; 
      color: #444; 
      line-height: 1.6;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1976d2, #2196f3);
      text-align: center;
      padding: 30px 20px;
      color: #fff;
    }
    .header h2 { font-size: 28px; font-weight: 700; }
    .header img { margin-top: 10px; max-width: 80px; }
    .content { padding: 30px 20px; }
    .content p { margin-bottom: 16px; font-size: 16px; }
    .details { margin: 20px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; }
    .details-item { display: flex; justify-content: space-between; padding: 12px 0; }
    .details-item span { font-size: 15px; }
    .details-item .label { color: #888; }
    .footer { text-align: center; font-size: 14px; color: #999; padding: 20px; background: #fafafa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Cita agendada</h2>
      <img src="https://icon-icons.com/icons2/624/PNG/512/Planner-80_icon-icons.com_57289.png" alt="Logo" />
    </div>
    <div class="content">
      <p><strong>Paciente:</strong> ${paciente_nombre}</p>
      <div class="details">
        <div class="details-item">
          <span class="label">Fecha:</span>
          <span class="value">${fechaFormateada}</span>
        </div>
        <div class="details-item">
          <span class="label">Hora:</span>
          <span class="value">${hora} hs</span>
        </div>
        <div class="details-item">
          <span class="label">Profesional:</span>
          <span class="value">${profesion} ${cliente_nombre}</span>
        </div>
        <div class="details-item">
          <span class="label">Dirección:</span>
          <span class="value">${direccion}</span>
        </div>
        <div class="details-item">
          <span class="label">Teléfono:</span>
          <span class="value">${telefono}</span>
        </div>
      </div>
    </div>
    <div class="footer">
      <p>Gracias por confiar en nosotros.</p>
    </div>
  </div>
</body>
</html>
`;
    await enviarCorreo({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Cita agendada',
      html: htmlCorreo
    });
    res.status(201).json(nuevaCita);
  } catch (error) {
    console.error("❌ Error al agendar cita:", error);
    res.status(500).json({ error: 'Error al agendar cita' });
  }
});

app.put('/api/citas/:id/asistencia', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden actualizar asistencia.' });
  }
  const { id } = req.params;
  const { asistio } = req.body;
  if (asistio === undefined) {
    return res.status(400).json({ error: 'Se requiere el estado de asistencia' });
  }
  try {
    const result = await pool.query(
      `UPDATE citas 
       SET asistio = $1, estado = $2 
       WHERE id = $3 
         AND paciente_id IN (SELECT id FROM pacientes WHERE cliente_id = $4)
       RETURNING *`,
      [asistio, 'cerrado', id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al actualizar asistencia:", error);
    res.status(500).json({ error: 'Error al actualizar asistencia' });
  }
});

app.delete('/api/citas/:id', verificarToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso denegado. Solo los clientes pueden eliminar sus citas.' });
  }
  const { id } = req.params;
  const { motivo } = req.body;
  try {
    const citaInfo = await pool.query(`
      SELECT c.id, c.fecha, c.hora, p.email, p.nombre AS paciente_nombre
      FROM citas c
      JOIN pacientes p ON c.paciente_id = p.id
      WHERE c.id = $1
        AND p.cliente_id = $2
        AND c.estado = 'abierto'
    `, [id, req.user.id]);
    if (citaInfo.rowCount === 0) {
      return res.status(404).json({ error: 'Cita no encontrada o ya cerrada' });
    }
    const { fecha, hora, email, paciente_nombre } = citaInfo.rows[0];
    const result = await pool.query(
      `DELETE FROM citas
       WHERE id = $1 
         AND paciente_id IN (SELECT id FROM pacientes WHERE cliente_id = $2)
       RETURNING *`,
      [id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    console.log(`✅ Cita con ID ${id} eliminada correctamente.`);
    const asunto = 'Tu cita ha sido cancelada';
    const htmlCancelacion = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Cita Cancelada</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          background-color: #f5f5f5;
          color: #333;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #d32f2f, #f44336);
          padding: 25px;
          text-align: center;
          color: #fff;
        }
        .header h2 { margin: 0; font-size: 24px; }
        .content { padding: 25px 30px; }
        .content p { margin-bottom: 16px; font-size: 16px; }
        .footer {
          text-align: center;
          font-size: 14px;
          color: #777;
          padding: 15px;
          border-top: 1px solid #eee;
          background-color: #fafafa;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Cita Cancelada</h2>
        </div>
        <div class="content">
          <p>Estimado/a <strong>${paciente_nombre}</strong>,</p>
          <p>Te informamos que tu cita programada para la fecha <strong>${fecha.toISOString().split('T')[0]}</strong> 
          a las <strong>${hora}hs</strong> ha sido cancelada.</p>
          <p><strong>Motivo:</strong> ${motivo || 'Sin especificar'}</p>
          <p>Si tienes alguna duda, por favor contáctanos. Gracias por utilizar nuestro servicio.</p>
        </div>
        <div class="footer">
          <p>Atentamente,</p>
          <p>El equipo de Citas</p>
        </div>
      </div>
    </body>
    </html>
    `;
    await enviarCorreo({
      from: process.env.EMAIL_USER,
      to: email,
      subject: asunto,
      html: htmlCancelacion,
    });
    res.json({ 
      message: 'Cita eliminada correctamente', 
      motivoRecibido: motivo || '(No se proporcionó motivo)' 
    });
  } catch (error) {
    console.error("❌ Error al eliminar la cita:", error);
    res.status(500).json({ error: 'Error al eliminar la cita' });
  }
});



app.get('/api/citas/historial/:paciente_id', verificarToken, async (req, res) => {
  const { paciente_id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM citas WHERE paciente_id = $1 AND estado = $2 ORDER BY fecha DESC',
      [paciente_id, 'cerrado']
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error al obtener historial de citas:", error);
    res.status(500).json({ error: 'Error al obtener historial de citas' });
  }
});

// ────────────────────────────────────────────────
// Endpoint para verificar que el servidor esté activo
// ────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.send("🟢 API funcionando correctamente");
});

// ────────────────────────────────────────────────
// Iniciar el servidor
// ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
