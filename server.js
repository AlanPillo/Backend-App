require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const crypto = require('crypto'); // para generar el token de confirmación, si lo necesitas

const app = express();
app.use(express.json());
app.use(cors());

// 📌 Clave JWT (puedes moverla a .env si lo prefieres)
const SECRET_KEY = 'secreto_super_seguro';

// 📌 Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Ej: postgresql://postgres:Developer2314@localhost:5432/dentaldb
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

// Función para generar HTML elegante para los correos
function generarHtmlCorreo({ nombre, fechaFormateada, hora, waLink, mensajeAdicional }) {
  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f0f2f5; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 20px; }
        .header { text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eee; }
        .header h2 { margin: 0; color: #1976d2; }
        .content { padding: 20px 0; }
        .content p { margin: 10px 0; font-size: 16px; }
        .footer { text-align: center; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #777; }
        .btn-wa { display: inline-block; background-color: #25D366; color: #fff; padding: 12px 24px; margin-top: 20px; text-decoration: none; border-radius: 4px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Recordatorio de Cita</h2>
        </div>
        <div class="content">
          <p>Hola <strong>${nombre}</strong>,</p>
          <p>${mensajeAdicional || 'Este es un recordatorio de que tienes una cita programada.'}</p>
          <p><strong>Fecha:</strong> ${fechaFormateada}</p>
          <p><strong>Hora:</strong> ${hora} hrs</p>
          <p>Si tienes algún inconveniente, por favor contacta vía WhatsApp haciendo clic en el botón de abajo:</p>
          <div style="text-align: center;">
            <a href="${waLink}" class="btn-wa">Contactar WhatsApp</a>
          </div>
        </div>
        <div class="footer">
          <p>Gracias por confiar en nosotros.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// 🔹 Tarea programada: enviar recordatorio 48 horas antes de la cita (diariamente a las 09:00 AM)
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

    // Buscar citas para la fecha objetivo con estado 'abierto'
    const citas = await pool.query(`
      SELECT c.id AS cita_id, c.fecha, c.hora, p.email, p.nombre
      FROM citas c
      JOIN pacientes p ON c.paciente_id = p.id
      WHERE to_char(c.fecha, 'YYYY-MM-DD') = $1 AND c.estado = 'abierto'
    `, [fechaTarget]);

    for (const cita of citas.rows) {
      const { cita_id, fecha, hora, email, nombre } = cita;
      // Generar enlace de WhatsApp predefinido
      const mensaje = encodeURIComponent(`Hola, buenas. Soy ${nombre}, desafortunadamente no puedo asistir a mi cita programada para el ${fecha.toString().split('T')[0]} a las ${hora}.`);
      const waLink = `https://wa.me/59891014583?text=${mensaje}`;

      const html = generarHtmlCorreo({
        nombre,
        fechaFormateada: fecha.toString().split('T')[0],
        hora,
        waLink
      });

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

// 🔹 MODO DE PRUEBA: Enviar recordatorio 5 minutos después de la reserva (si TEST_MODE es true)
const TEST_MODE = process.env.TEST_MODE === 'true';
if (TEST_MODE) {
  console.log("⚠️ Modo de prueba activado: se enviará un recordatorio 5 minutos después de la reserva");
}

// 🔐 Middleware para verificar token (JWT)
const verificarToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(" ")[1];
  if (!token) {
    return res.status(403).json({ error: 'Token requerido' });
  }
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    req.user = decoded;
    next();
  });
};

// 🔹 Iniciar sesión (solo para el dentista)
app.post('/api/login', async (req, res) => {
  const { nombre, password } = req.body;
  try {
    console.log("🟡 Intento de login para:", nombre);
    const result = await pool.query('SELECT * FROM dentista WHERE nombre = $1', [nombre]);
    if (result.rows.length === 0) {
      console.error("❌ Dentista no encontrado.");
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const dentista = result.rows[0];
    const isMatch = await bcrypt.compare(password, dentista.password_hash);
    if (!isMatch) {
      console.error("❌ Contraseña incorrecta.");
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const token = jwt.sign({ id: dentista.id, role: 'admin' }, SECRET_KEY, { expiresIn: '8h' });
    console.log("✅ Token generado correctamente.");
    res.json({ message: 'Inicio de sesión exitoso', token });
  } catch (error) {
    console.error('❌ Error en el login:', error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// 🔹 Rutas de Pacientes

// Agregar un nuevo paciente (PROTEGIDO)
app.post('/api/pacientes', verificarToken, async (req, res) => {
  const { nombre, email, telefono } = req.body;
  if (!nombre || !email || !telefono) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO pacientes (nombre, email, telefono) VALUES ($1, $2, $3) RETURNING *',
      [nombre, email, telefono]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al agregar paciente:", error);
    res.status(500).json({ error: 'Error al agregar paciente' });
  }
});

// Obtener todos los pacientes con sus citas abiertas (PROTEGIDO)
app.get('/api/pacientes', verificarToken, async (req, res) => {
  try {
    const pacientesResult = await pool.query('SELECT * FROM pacientes ORDER BY id DESC');
    const citasResult = await pool.query('SELECT * FROM citas');
    // Combinar pacientes con sus citas donde estado es 'abierto'
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

// Obtener el historial de citas cerradas para un paciente (PROTEGIDO)
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
    res.status(500).json({ error: "Error al obtener historial de citas" });
  }
});

// Obtener un paciente por ID (PROTEGIDO)
app.get('/api/pacientes/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM pacientes WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al obtener paciente:", error);
    res.status(500).json({ error: "Error al obtener paciente" });
  }
});

// Actualizar un paciente por ID (PROTEGIDO)
app.put('/api/pacientes/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { nombre, email, telefono } = req.body;
  if (!nombre || !email || !telefono) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  try {
    const result = await pool.query(
      'UPDATE pacientes SET nombre = $1, email = $2, telefono = $3 WHERE id = $4 RETURNING *',
      [nombre, email, telefono, id]
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

// 🔹 Rutas de Citas

// Función para formatear fecha: "13 de marzo del 2025"
function formatearFecha(fechaISO) {
  const dateObj = new Date(fechaISO);
  const day = dateObj.getDate();
  const monthIndex = dateObj.getMonth();
  const year = dateObj.getFullYear();
  const meses = [
    'enero', 'febrero', 'marzo', 'abril',
    'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  return `${day} de ${meses[monthIndex]} del ${year}`;
}

// Agendar una cita (PROTEGIDO) – incluye envío de correo en HTML
// Se asume que la columna "asistio" se inicializa en NULL para citas pendientes y "estado" es 'abierto'
app.post('/api/citas', verificarToken, async (req, res) => {
  const { paciente_id, fecha, hora, notas } = req.body;
  if (!paciente_id || !fecha || !hora) {
    return res.status(400).json({ error: 'Paciente, fecha y hora son obligatorios' });
  }
  // Verificar que el paciente no tenga ya una cita pendiente (estado = 'abierto')
  const citaExistente = await pool.query(
    'SELECT * FROM citas WHERE paciente_id = $1 AND estado = $2',
    [paciente_id, 'abierto']
  );
  if (citaExistente.rows.length > 0) {
    return res.status(400).json({ error: 'El paciente ya tiene una cita pendiente' });
  }
  // Verificar que la fecha sea posterior a hoy
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaCita = new Date(fecha);
  if (fechaCita <= hoy) {
    return res.status(400).json({ error: 'La cita debe ser agendada para un día posterior a hoy' });
  }
  try {
    // Generar un token único para el enlace de recordatorio (opcional)
    const tokenConfirmacion = crypto.randomBytes(20).toString('hex');
    // Insertar la cita en la BD (confirmada: false, asistio: NULL, estado: 'abierto')
    const result = await pool.query(
      'INSERT INTO citas (paciente_id, fecha, hora, notas, confirmada, asistio, estado, tokenConfirmacion) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [paciente_id, fecha, hora, notas || '', false, null, 'abierto', tokenConfirmacion]
    );
    const nuevaCita = result.rows[0];
    // Obtener email y nombre del paciente
    const pacienteResult = await pool.query('SELECT email, nombre FROM pacientes WHERE id = $1', [paciente_id]);
    const { email, nombre } = pacienteResult.rows[0];
    // Formatear la fecha
    const fechaFormateada = formatearFecha(fecha);
    // Generar enlace de WhatsApp para problemas (mensaje predefinido)
    const mensaje = encodeURIComponent(`Hola, buenas. Soy ${nombre}, desafortunadamente no puedo asistir a mi cita programada para el ${fechaFormateada} a las ${hora}.`);
    const waLink = `https://wa.me/59891014583?text=${mensaje}`;
    // Enviar correo de aviso de nueva cita (HTML) con imagen de ejemplo y enlace a WhatsApp
    const htmlCorreo = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f0f2f5; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 20px; }
          .header { text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eee; }
          .header h2 { margin: 0; color: #1976d2; }
          .content { padding: 20px 0; }
          .content p { margin: 10px 0; font-size: 16px; }
          .footer { text-align: center; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #777; }
          .btn-wa { display: inline-block; background-color: #25D366; color: #fff; padding: 12px 24px; margin-top: 20px; text-decoration: none; border-radius: 4px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Cita agendada</h2>
            <img src="https://i.pinimg.com/736x/6f/7d/4a/6f7d4a5cca96ff31d058b8c41700b7f7.jpg" alt="Logo" style="max-width:150px;" />
          </div>
          <div class="content">
            <p><strong>Paciente:</strong> ${nombre}</p>
            <p><strong>Fecha:</strong> ${fechaFormateada}</p>
            <p><strong>Hora:</strong> ${hora} hrs</p>
            <p><strong>Profesional:</strong> Pepe Rodriguez</p>
            <p><strong>Dirección:</strong> Avenida 8 de Octubre 2331, B, Montevideo</p>
            <p><strong>Teléfono de contacto:</strong> +59891014583</p>
          </div>
          <div class="footer">
            <p>Si tienes algún inconveniente, comunícate vía WhatsApp:</p>
            <a href="${waLink}" class="btn-wa">Contactar WhatsApp</a>
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

    // MODO DE PRUEBA: Enviar recordatorio 5 minutos después de la reserva
    if (process.env.TEST_MODE === 'true') {
      setTimeout(async () => {
        const mensajeTest = encodeURIComponent(`Hola, buenas. Soy ${nombre}, este es un recordatorio de prueba para mi cita programada para el ${fechaFormateada} a las ${hora}.`);
        const waLinkTest = `https://wa.me/59891014583?text=${mensajeTest}`;
        const htmlTest = `
          <!DOCTYPE html>
          <html lang="es">
          <head>
            <meta charset="UTF-8" />
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f0f2f5; color: #333; margin: 0; padding: 0; }
              .container { max-width: 600px; margin: 40px auto; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 20px; }
              .header { text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eee; }
              .header h2 { margin: 0; color: #1976d2; }
              .content { padding: 20px 0; }
              .content p { margin: 10px 0; font-size: 16px; }
              .footer { text-align: center; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #777; }
              .btn-wa { display: inline-block; background-color: #25D366; color: #fff; padding: 12px 24px; margin-top: 20px; text-decoration: none; border-radius: 4px; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h2>Recordatorio de Cita (Prueba)</h2>
              </div>
              <div class="content">
                <p>Hola <strong>${nombre}</strong>,</p>
                <p>Este es un recordatorio de prueba para tu cita programada para el ${fechaFormateada} a las ${hora}.</p>
                <p>Si tienes algún inconveniente, comunícate vía WhatsApp:</p>
              </div>
              <div class="footer">
                <a href="${waLinkTest}" class="btn-wa">Contactar WhatsApp</a>
              </div>
            </div>
          </body>
          </html>
        `;
        await enviarCorreo({
          from: process.env.EMAIL_USER,
          to: email,
          subject: 'Recordatorio de Cita (Prueba)',
          html: htmlTest
        });
        console.log("✅ Recordatorio de prueba enviado a:", email);
      }, 5 * 60 * 1000); // 5 minutos
    }

    res.status(201).json(nuevaCita);
  } catch (error) {
    console.error("❌ Error al agendar cita:", error);
    res.status(500).json({ error: 'Error al agendar cita' });
  }
});

// (Opcional) Endpoint para confirmación o cancelación de cita por el dentista (PROTEGIDO)
app.post('/api/citas/:id/confirmar', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { confirmar } = req.body;
  if (confirmar === undefined) {
    return res.status(400).json({ error: 'Se requiere el estado de confirmación' });
  }
  try {
    const result = await pool.query(
      'UPDATE citas SET confirmada = $1, estado = $2 WHERE id = $3 RETURNING *',
      [confirmar, 'cerrado', id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error al actualizar cita:", error);
    res.status(500).json({ error: 'Error al actualizar cita' });
  }
});

// Actualizar asistencia (PROTEGIDO)
app.put('/api/citas/:id/asistencia', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { asistio } = req.body;
  if (asistio === undefined) {
    return res.status(400).json({ error: 'Se requiere el estado de asistencia' });
  }
  try {
    const result = await pool.query(
      'UPDATE citas SET asistio = $1, estado = $2 WHERE id = $3 RETURNING *',
      [asistio, 'cerrado', id]
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

// Eliminar (cancelar) una cita (PROTEGIDO)
app.delete('/api/citas/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM citas WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    console.log(`✅ Cita con ID ${id} eliminada correctamente.`);
    res.json({ message: 'Cita eliminada correctamente' });
  } catch (error) {
    console.error("❌ Error al eliminar la cita:", error);
    res.status(500).json({ error: 'Error al eliminar la cita' });
  }
});

// 🔹 Endpoint para verificar que el servidor tenga rutas activas
app.get('/api', (req, res) => {
  res.send("🟢 API funcionando correctamente");
});

// 🔹 Iniciar el servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
