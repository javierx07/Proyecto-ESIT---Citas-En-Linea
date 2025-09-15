const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const twilio = require('twilio');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Conectado a MongoDB');
}).catch(err => {
    console.error('Error al conectar a MongoDB:', err);
});

// Esquema de MongoDB para las citas
const citaSchema = new mongoose.Schema({
    nombreCompleto: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    telefono: {
        type: String,
        required: true,
        trim: true
    },
    tipoServicio: {
        type: String,
        required: true,
        enum: [
            'limpieza-dental',
            'ortodoncia', 
            'extracciones',
            'implantes',
            'carillas',
            'diseño-sonrisa',
            'radiografia',
            'protesis-dentales'
        ]
    },
    fecha: {
        type: Date,
        required: true
    },
    horario: {
        type: String,
        required: true,
        enum: ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']
    },
    estado: {
        type: String,
        default: 'confirmada',
        enum: ['confirmada', 'cancelada', 'completada']
    },
    googleCalendarEventId: {
        type: String
    },
    fechaCreacion: {
        type: Date,
        default: Date.now
    }
});

// Crear índice único para evitar citas duplicadas en la misma fecha/hora
citaSchema.index({ fecha: 1, horario: 1 }, { unique: true });

const Cita = mongoose.model('Cita', citaSchema);

// Configuración de Twilio
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Configuración de Google Calendar
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Funciones auxiliares
function formatearServicio(servicio) {
    const servicios = {
        'limpieza-dental': 'Limpieza Dental',
        'ortodoncia': 'Ortodoncia',
        'extracciones': 'Extracciones',
        'implantes': 'Implantes',
        'carillas': 'Carillas',
        'diseño-sonrisa': 'Diseño de Sonrisa',
        'radiografia': 'Radiografía',
        'protesis-dentales': 'Prótesis Dentales'
    };
    return servicios[servicio] || servicio;
}

function formatearHora(hora) {
    const [horas, minutos] = hora.split(':');
    const horaNum = parseInt(horas);
    const ampm = horaNum < 12 ? 'AM' : 'PM';
    const horaFormateada = horaNum > 12 ? horaNum - 12 : horaNum;
    return `${horaFormateada}:${minutos} ${ampm}`;
}

async function crearEventoGoogleCalendar(cita) {
    try {
        const fechaHora = new Date(`${cita.fecha.toISOString().split('T')[0]}T${cita.horario}:00.000Z`);
        const fechaFin = new Date(fechaHora);
        fechaFin.setHours(fechaFin.getHours() + 1); // Duración de 1 hora

        const evento = {
            summary: `Cita Dental - ${cita.nombreCompleto}`,
            description: `
                Paciente: ${cita.nombreCompleto}
                Email: ${cita.email}
                Teléfono: ${cita.telefono}
                Servicio: ${formatearServicio(cita.tipoServicio)}
            `,
            start: {
                dateTime: fechaHora.toISOString(),
                timeZone: 'America/El_Salvador'
            },
            end: {
                dateTime: fechaFin.toISOString(),
                timeZone: 'America/El_Salvador'
            },
            attendees: [
                { email: cita.email }
            ],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 }, // 1 día antes
                    { method: 'popup', minutes: 60 } // 1 hora antes
                ]
            }
        };

        const response = await calendar.events.insert({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            resource: evento
        });

        return response.data.id;
    } catch (error) {
        console.error('Error al crear evento en Google Calendar:', error);
        throw error;
    }
}

async function enviarSMSConfirmacion(cita) {
    try {
        const fechaFormateada = new Date(cita.fecha).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const mensaje = `
¡Cita confirmada! 🦷

📅 Fecha: ${fechaFormateada}
🕐 Hora: ${formatearHora(cita.horario)}
🔧 Servicio: ${formatearServicio(cita.tipoServicio)}

Para cancelar cita, llama al 74676260

¡Te esperamos!
        `.trim();

        await twilioClient.messages.create({
            body: mensaje,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: cita.telefono
        });

        console.log(`SMS enviado a ${cita.telefono}`);
    } catch (error) {
        console.error('Error al enviar SMS:', error);
        throw error;
    }
}

// Rutas de la API
app.get('/api/appointments/occupied', async (req, res) => {
    try {
        const citasOcupadas = await Cita.find(
            { 
                estado: 'confirmada',
                fecha: { $gte: new Date() } // Solo fechas futuras
            },
            'fecha horario'
        ).lean();

        res.json(citasOcupadas);
    } catch (error) {
        console.error('Error al obtener citas ocupadas:', error);
        res.status(500).json({ 
            error: 'Error del servidor',
            mensaje: 'No se pudieron cargar los horarios ocupados' 
        });
    }
});

app.post('/api/appointments', [
    body('nombreCompleto')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
    
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Debe ser un email válido'),
    
    body('telefono')
        .matches(/^\+503[0-9]{8}$/)
        .withMessage('El teléfono debe tener el formato +503XXXXXXXX'),
    
    body('tipoServicio')
        .isIn(['limpieza-dental', 'ortodoncia', 'extracciones', 'implantes', 'carillas', 'diseño-sonrisa', 'radiografia', 'protesis-dentales'])
        .withMessage('Tipo de servicio no válido'),
    
    body('fecha')
        .isISO8601()
        .toDate()
        .custom((fecha) => {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            if (fecha < hoy) {
                throw new Error('La fecha no puede ser en el pasado');
            }
            return true;
        }),
    
    body('horario')
        .isIn(['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'])
        .withMessage('Horario no válido')
], async (req, res) => {
    try {
        // Validar errores de entrada
        const errores = validationResult(req);
        if (!errores.isEmpty()) {
            return res.status(400).json({
                error: 'Datos inválidos',
                mensaje: 'Por favor verifica que todos los campos estén correctos',
                errores: errores.array()
            });
        }

        const { nombreCompleto, email, telefono, tipoServicio, fecha, horario } = req.body;

        // Verificar si ya existe una cita en esa fecha y hora
        const citaExistente = await Cita.findOne({
            fecha: new Date(fecha),
            horario: horario,
            estado: 'confirmada'
        });

        if (citaExistente) {
            return res.status(409).json({
                error: 'Horario ocupado',
                mensaje: 'Lo sentimos, la fecha y hora ya fue reservada por alguien más, intente de nuevo.'
            });
        }

        // Crear la nueva cita
        const nuevaCita = new Cita({
            nombreCompleto,
            email,
            telefono,
            tipoServicio,
            fecha: new Date(fecha),
            horario
        });

        // Guardar en la base de datos
        await nuevaCita.save();

        let googleEventId = null;
        let smsEnviado = false;

        // Intentar crear evento en Google Calendar
        try {
            googleEventId = await crearEventoGoogleCalendar(nuevaCita);
            nuevaCita.googleCalendarEventId = googleEventId;
            await nuevaCita.save();
            console.log('Evento creado en Google Calendar');
        } catch (error) {
            console.error('Error al crear evento en Google Calendar, pero la cita se guardó:', error);
        }

        // Intentar enviar SMS de confirmación
        try {
            await enviarSMSConfirmacion(nuevaCita);
            smsEnviado = true;
            console.log('SMS de confirmación enviado');
        } catch (error) {
            console.error('Error al enviar SMS, pero la cita se guardó:', error);
        }

        res.status(201).json({
            mensaje: 'Cita agendada con éxito',
            cita: {
                id: nuevaCita._id,
                nombreCompleto: nuevaCita.nombreCompleto,
                fecha: nuevaCita.fecha,
                horario: nuevaCita.horario,
                tipoServicio: nuevaCita.tipoServicio
            },
            integraciones: {
                googleCalendar: !!googleEventId,
                sms: smsEnviado
            }
        });

    } catch (error) {
        console.error('Error al crear cita:', error);
        
        if (error.code === 11000) {
            // Error de duplicado (fecha/hora ya ocupada)
            return res.status(409).json({
                error: 'Horario ocupado',
                mensaje: 'Lo sentimos, la fecha y hora ya fue reservada por alguien más, intente de nuevo.'
            });
        }

        res.status(500).json({
            error: 'Error del servidor',
            mensaje: 'Ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo.'
        });
    }
});

// Ruta para obtener todas las citas (opcional, para administración)
app.get('/api/appointments', async (req, res) => {
    try {
        const citas = await Cita.find()
            .sort({ fecha: 1, horario: 1 })
            .lean();

        res.json(citas);
    } catch (error) {
        console.error('Error al obtener citas:', error);
        res.status(500).json({
            error: 'Error del servidor',
            mensaje: 'No se pudieron cargar las citas'
        });
    }
});

// Ruta para cancelar una cita (opcional)
app.patch('/api/appointments/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        
        const cita = await Cita.findByIdAndUpdate(
            id,
            { estado: 'cancelada' },
            { new: true }
        );

        if (!cita) {
            return res.status(404).json({
                error: 'Cita no encontrada',
                mensaje: 'La cita que intentas cancelar no existe'
            });
        }

        // Intentar eliminar el evento de Google Calendar
        if (cita.googleCalendarEventId) {
            try {
                await calendar.events.delete({
                    calendarId: process.env.GOOGLE_CALENDAR_ID,
                    eventId: cita.googleCalendarEventId
                });
                console.log('Evento eliminado de Google Calendar');
            } catch (error) {
                console.error('Error al eliminar evento de Google Calendar:', error);
            }
        }

        res.json({
            mensaje: 'Cita cancelada exitosamente',
            cita: {
                id: cita._id,
                estado: cita.estado
            }
        });

    } catch (error) {
        console.error('Error al cancelar cita:', error);
        res.status(500).json({
            error: 'Error del servidor',
            mensaje: 'No se pudo cancelar la cita'
        });
    }
});

// Middleware para manejo de errores
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Error interno del servidor',
        mensaje: 'Algo salió mal. Por favor intenta de nuevo más tarde.'
    });
});

// Ruta para verificar que el servidor está funcionando
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        message: 'Servidor de citas dentales funcionando correctamente'
    });
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    console.log(`Salud del servidor: http://localhost:${PORT}/health`);
});