# Corrector IA

Una herramienta para profesores que corrige exámenes y tareas automáticamente con inteligencia artificial.

---

## ¿Para qué sirve?

Corrector IA se conecta a tu Google Classroom, descarga las entregas de los alumnos y las corrige una por una usando IA. En pocos minutos tienes:

- Una nota del 0 al 10 para cada alumno
- Un informe de feedback detallado por alumno
- Una hoja de Excel con todas las notas y un resumen estadístico
- La opción de publicar los informes directamente en Classroom, visibles solo para cada alumno

También puedes usarla **sin Google Classroom**, subiendo los archivos directamente desde tu ordenador.

---

## ¿Cómo funciona? (paso a paso)

### 1. Conéctate con tu cuenta de Google
Inicia sesión con tu cuenta de Google para que la app pueda acceder a tus clases y entregas de Classroom.

### 2. Carga la tarea que quieres corregir
Tienes dos opciones:

- **Desde Google Classroom**: elige la clase y la tarea desde un desplegable, o pega directamente la URL de la tarea.
- **Desde tu ordenador**: sube los archivos de los alumnos arrastrándolos o buscándolos en tu disco.

La app acepta imágenes, PDFs, documentos Word y texto. Si tienes un PDF con los exámenes de varios alumnos juntos, la app puede separarlos automáticamente.

### 3. Configura la corrección
Antes de corregir puedes:

- **Añadir material de referencia**: sube la rúbrica, la solución modelo o cualquier pauta de corrección (hasta 10 archivos).
- **Escribir instrucciones**: especifica criterios de corrección, pesos de cada pregunta, o cualquier indicación para la IA.
- **Guardar plantillas**: guarda tus instrucciones como plantilla para reutilizarlas en futuras correcciones.
- **Elegir alumnos**: selecciona qué alumnos quieres corregir en esta sesión.
- **Editar el prompt**: si quieres, puedes ver y modificar exactamente qué se le envía a la IA.

### 4. Revisa los resultados
Una vez terminada la corrección:

- Consulta el informe de cada alumno con su nota, puntos fuertes, errores, feedback detallado y pasos de mejora.
- Descarga todos los informes y el Excel en un ZIP.
- Publica los informes en Google Classroom con un clic (cada alumno solo ve el suyo).

---

## Herramienta de anonimización

Si no quieres enviar los nombres de los alumnos a la IA, la app incluye una herramienta para tachar esa información antes de la corrección. Puedes dibujar manualmente las zonas a ocultar o dejar que la app las detecte automáticamente.

---

## ¿Qué modelos de IA puedes usar?

Puedes elegir entre tres proveedores desde los ajustes:

| Proveedor | Modelos disponibles | Notas |
|---|---|---|
| **Gemini** (por defecto) | Gemini Flash | 1500 correcciones/día gratis |
| **Groq** | Llama 4 Scout / Llama 4 Maverick | Muy rápido, cuota diaria limitada |
| **Claude** | Haiku / Sonnet / Opus | Alta calidad, requiere API key de pago |

Para cambiar de proveedor o introducir tus API keys, abre el panel de **Ajustes** desde la app.

---

## Requisitos

- Node.js 20 o superior
- Una cuenta de Google (para usar Classroom)
- Al menos una API key de alguno de los proveedores de IA (Gemini, Groq o Claude)

---

## Instalación local

```bash
# Instalar dependencias
npm install

# Colocar el archivo de credenciales de Google OAuth en la raíz del proyecto
# (client_secret_*.json)

# Arrancar la app
npm start
```

Abre el navegador en `http://localhost:3000` y haz clic en "Iniciar sesión con Google".

---

## Despliegue en Render.com

El archivo `render.yaml` incluido configura el despliegue automáticamente. Las variables de entorno que necesitas configurar en el panel de Render son:

| Variable | Descripción |
|---|---|
| `GOOGLE_CREDENTIALS` | Contenido del archivo `client_secret_*.json` |
| `GOOGLE_TOKEN` | Token OAuth (cópialo desde `/auth/token-export` tras iniciar sesión en local) |
| `REDIRECT_URI` | `https://tu-app.onrender.com/auth/callback` |
| `GEMINI_API_KEY` | API key de Gemini |
| `GROQ_API_KEY` | API key de Groq |
| `DATA_DIR` | `/var/data` |
