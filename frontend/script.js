/**
 * Sistema de Citas Dentales - Frontend
 * Maneja la lógica de la interfaz de usuario para reservas de citas
 */

class SistemaCitas {
    constructor() {
        // Configuración de la API
        this.apiUrl = 'http://localhost:3000/api';
        
        // Datos del sistema
        this.citasOcupadas = [];
        this.horarios = [
            '08:00', '09:00', '10:00', '11:00', 
            '13:00', '14:00', '15:00', '16:00'
        ];

        // Inicializar la aplicación
        this.init();
    }

    /**
     * Inicializa la aplicación
     */
    async init() {
        this.setupEventListeners();
        this.setupDateConstraints();
        this.generateTimeOptions();
        await this.cargarCitasOcupadas();
    }

    /**
     * Configura los event listeners
     */
    setupEventListeners() {
        const form = document.getElementById('appointmentForm');
        const fechaInput = document.getElementById('fecha');
        const telefonoInput = document.getElementById('telefono');

        // Envío del formulario
        form.addEventListener('submit', (e) => this.enviarFormulario(e));
        
        // Cambio de fecha para actualizar horarios
        fechaInput.addEventListener('change', () => this.actualizarHorariosDisponibles());
        
        // Validación de teléfono (solo números)
        telefonoInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });

        // Validación de longitud de teléfono
        telefonoInput.addEventListener('blur', (e) => {
            if (e.target.value.length > 0 && e.target.value.length !== 8) {
                this.mostrarMensaje('El número de teléfono debe tener exactamente 8 dígitos.', 'error');
            }
        });
    }

    /**
     * Configura las restricciones de fecha
     */
    setupDateConstraints() {
        const fechaInput = document.getElementById('fecha');
        const hoy = new Date();
        
        // Fecha mínima: hoy
        const minFecha = hoy.toISOString().split('T')[0];
        
        // Fecha máxima: 3 meses adelante
        const maxFecha = new Date(hoy);
        maxFecha.setMonth(maxFecha.getMonth() + 3);
        
        fechaInput.min = minFecha;
        fechaInput.max = maxFecha.toISOString().split('T')[0];
    }

    /**
     * Genera las opciones de horario en el select
     */
    generateTimeOptions() {
        const horarioSelect = document.getElementById('horario');
        
        // Limpiar opciones existentes (excepto la primera)
        while (horarioSelect.children.length > 1) {
            horarioSelect.removeChild(horarioSelect.lastChild);
        }
        
        // Agregar opciones de horario
        this.horarios.forEach(hora => {
            const option = document.createElement('option');
            option.value = hora;
            option.textContent = this.formatearHora(hora);
            horarioSelect.appendChild(option);
        });
    }

    /**
     * Formatea una hora de 24h a 12h con AM/PM
     * @param {string} hora - Hora en formato 24h (ej: "14:00")
     * @returns {string} Hora formateada (ej: "2:00 PM")
     */
    formatearHora(hora) {
        const [horas, minutos] = hora.split(':');
        const horaNum = parseInt(horas);
        const ampm = horaNum < 12 ? 'AM' : 'PM';
        const horaFormateada = horaNum > 12 ? horaNum - 12 : (horaNum === 0 ? 12 : horaNum);
        return `${horaFormateada}:${minutos} ${ampm}`;
    }

    /**
     * Carga las citas ocupadas desde el backend
     */
    async cargarCitasOcupadas() {
        const loadingMessage = document.getElementById('loadingMessage');
        loadingMessage.style.display = 'block';

        try {
            const response = await fetch(`${this.apiUrl}/appointments/occupied`);
            
            if (response.ok) {
                this.citasOcupadas = await response.json();
                console.log('Citas ocupadas cargadas:', this.citasOcupadas.length);
            } else {
                console.error('Error al cargar citas ocupadas:', response.status);
                this.mostrarMensaje('Error al cargar los horarios. Algunos horarios pueden no estar actualizados.', 'error');
            }
        } catch (error) {
            console.error('Error de conexión:', error);
            this.mostrarMensaje('Error al conectar con el servidor. Verifica tu conexión.', 'error');
        } finally {
            loadingMessage.style.display = 'none';
        }
    }

    /**
     * Actualiza los horarios disponibles según la fecha seleccionada
     */
    actualizarHorariosDisponibles() {
        const fechaSeleccionada = document.getElementById('fecha').value;
        const horarioSelect = document.getElementById('horario');

        // Resetear todas las opciones
        Array.from(horarioSelect.options).forEach((option, index) => {
            if (index > 0) { // Skip primera opción (placeholder)
                option.disabled = false;
                option.style.color = '';
                option.textContent = this.formatearHora(option.value);
            }
        });

        if (!fechaSeleccionada) return;

        // Filtrar citas para la fecha seleccionada
        const citasFecha = this.citasOcupadas.filter(cita => {
            const fechaCita = new Date(cita.fecha).toISOString().split('T')[0];
            return fechaCita === fechaSeleccionada;
        });

        // Deshabilitar horarios ocupados
        citasFecha.forEach(cita => {
            const option = Array.from(horarioSelect.options).find(opt => opt.value === cita.horario);
            if (option) {
                option.disabled = true;
                option.style.color = '#999';
                option.textContent += ' (Ocupado)';
            }
        });

        // Limpiar selección si el horario ya no está disponible
        if (horarioSelect.value && horarioSelect.options[horarioSelect.selectedIndex].disabled) {
            horarioSelect.value = '';
        }
    }

    /**
     * Maneja el envío del formulario
     * @param {Event} e - Evento del formulario
     */
    async enviarFormulario(e) {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submitBtn');
        const formData = new FormData(e.target);
        
        // Construir objeto con datos del formulario
        const datosFormulario = {
            nombreCompleto: formData.get('nombreCompleto').trim(),
            email: formData.get('email').trim().toLowerCase(),
            telefono: `+503${formData.get('telefono')}`,
            tipoServicio: formData.get('tipoServicio'),
            fecha: formData.get('fecha'),
            horario: formData.get('horario')
        };

        // Validaciones adicionales
        if (!this.validarFormulario(datosFormulario)) {
            return;
        }

        // Deshabilitar botón y mostrar loading
        submitBtn.disabled = true;
        const textoOriginal = submitBtn.textContent;
        submitBtn.textContent = 'Agendando...';

        try {
            const response = await fetch(`${this.apiUrl}/appointments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(datosFormulario)
            });

            const resultado = await response.json();

            if (response.ok) {
                // Éxito
                this.mostrarMensaje('¡Cita agendada con éxito! Recibirás un SMS de confirmación en breve.', 'success');
                e.target.reset();
                this.generateTimeOptions(); // Regenerar opciones de horario
                await this.cargarCitasOcupadas(); // Recargar citas ocupadas
            } else {
                // Error del servidor
                this.mostrarMensaje(
                    resultado.mensaje || 'Error al agendar la cita. Intenta de nuevo.', 
                    'error'
                );
            }
        } catch (error) {
            console.error('Error de red:', error);
            this.mostrarMensaje(
                'Error de conexión. Verifica tu conexión a internet e intenta de nuevo.', 
                'error'
            );
        } finally {
            // Rehabilitar botón
            submitBtn.disabled = false;
            submitBtn.textContent = textoOriginal;
        }
    }

    /**
     * Valida los datos del formulario
     * @param {Object} datos - Datos del formulario
     * @returns {boolean} True si es válido
     */
    validarFormulario(datos) {
        // Validar nombre completo
        if (!datos.nombreCompleto || datos.nombreCompleto.length < 2) {
            this.mostrarMensaje('El nombre completo debe tener al menos 2 caracteres.', 'error');
            return false;
        }

        // Validar email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(datos.email)) {
            this.mostrarMensaje('Por favor ingresa un email válido.', 'error');
            return false;
        }

        // Validar teléfono
        if (!/^\+503[0-9]{8}$/.test(datos.telefono)) {
            this.mostrarMensaje('El número de teléfono debe tener exactamente 8 dígitos.', 'error');
            return false;
        }

        // Validar fecha no sea en el pasado
        const fechaCita = new Date(datos.fecha);
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        if (fechaCita < hoy) {
            this.mostrarMensaje('No puedes agendar una cita en una fecha pasada.', 'error');
            return false;
        }

        // Validar día de la semana (opcional - evitar domingos)
        const diaSemana = fechaCita.getDay();
        if (diaSemana === 0) { // Domingo
            this.mostrarMensaje('No se pueden agendar citas los domingos.', 'error');
            return false;
        }

        // Verificar si la fecha/hora ya está ocupada (doble verificación)
        const citaExiste = this.citasOcupadas.some(cita => {
            const fechaCitaExistente = new Date(cita.fecha).toISOString().split('T')[0];
            return fechaCitaExistente === datos.fecha && cita.horario === datos.horario;
        });

        if (citaExiste) {
            this.mostrarMensaje('Lo sentimos, la fecha y hora ya fue reservada por alguien más. Intenta de nuevo.', 'error');
            return false;
        }

        return true;
    }

    /**
     * Muestra un mensaje al usuario
     * @param {string} mensaje - Mensaje a mostrar
     * @param {string} tipo - Tipo de mensaje ('success' o 'error')
     */
    mostrarMensaje(mensaje, tipo) {
        const container = document.getElementById('messageContainer');
        
        // Crear elemento de mensaje
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${tipo}`;
        messageDiv.textContent = mensaje;
        
        // Limpiar mensajes anteriores y agregar nuevo
        container.innerHTML = '';
        container.appendChild(messageDiv);
        
        // Scroll al mensaje
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Auto-hide después de 5 segundos para mensajes de éxito
        if (tipo === 'success') {
            setTimeout(() => {
                if (container.contains(messageDiv)) {
                    messageDiv.style.transition = 'opacity 0.5s ease';
                    messageDiv.style.opacity = '0';
                    setTimeout(() => {
                        if (container.contains(messageDiv)) {
                            container.removeChild(messageDiv);
                        }
                    }, 500);
                }
            }, 5000);
        }
    }

    /**
     * Obtiene información sobre el estado del sistema
     * @returns {Object} Estado del sistema
     */
    getEstadoSistema() {
        return {
            citasOcupadas: this.citasOcupadas.length,
            horariosDisponibles: this.horarios.length,
            apiUrl: this.apiUrl,
            ultimaActualizacion: new Date().toISOString()
        };
    }
}

// Función para verificar la conectividad con el backend
async function verificarConexion() {
    try {
        const response = await fetch('http://localhost:3000/health');
        if (response.ok) {
            console.log('✅ Conexión con el backend exitosa');
            return true;
        } else {
            console.warn('⚠️ El backend respondió con un error');
            return false;
        }
    } catch (error) {
        console.error('❌ No se puede conectar con el backend:', error);
        return false;
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🦷 Iniciando Sistema de Citas Dentales...');
    
    // Verificar conexión con el backend
    const conexionOk = await verificarConexion();
    
    if (!conexionOk) {
        const messageContainer = document.getElementById('messageContainer');
        if (messageContainer) {
            messageContainer.innerHTML = `
                <div class="message error">
                    ⚠️ No se puede conectar con el servidor. 
                    Asegúrate de que el backend esté ejecutándose en http://localhost:3000
                </div>
            `;
        }
    }
    
    // Inicializar el sistema
    window.sistemaCitas = new SistemaCitas();
    console.log('✅ Sistema de citas inicializado correctamente');
});

// Manejar errores globales
window.addEventListener('error', (event) => {
    console.error('Error global capturado:', event.error);
});

// Manejar promesas rechazadas
window.addEventListener('unhandledrejection', (event) => {
    console.error('Promesa rechazada no manejada:', event.reason);
    event.preventDefault();
});

// Exportar para uso en pruebas o debugging
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SistemaCitas;
}