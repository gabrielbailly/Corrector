const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');
const archiver = require('archiver');
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch (e) {}
let sharp;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp no disponible — imágenes sin comprimir'); }

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  CONFIGURACIÓN
// ============================================================
const CREDENTIALS_PATH = path.join(
  __dirname,
  'client_secret_159626766732-hfshui318569lqjpapubkh0knkoct1kv.apps.googleusercontent.com.json'
);
const TOKEN_PATH  = path.join(__dirname, 'token.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');
// En producción (Railway) usar REDIRECT_URI como variable de entorno
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

// Config persistente (API keys, etc.)
let appConfig = {};
try { appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2)); } catch (e) {}
}
function getGroqKey() {
  // Prioridad: variable de entorno (Railway) > config.json (local)
  return process.env.GROQ_API_KEY || appConfig.groqApiKey || '';
}
function getGeminiKey() {
  return process.env.GEMINI_API_KEY || appConfig.geminiApiKey || '';
}
function getProvider() {
  if (appConfig.aiProvider) return appConfig.aiProvider;
  if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER;
  if (getGroqKey() && !getGeminiKey()) return 'groq';
  return 'gemini';
}
// Groq: único modelo de visión disponible actualmente
const GROQ_MODEL_DEFAULT = 'meta-llama/llama-4-scout-17b-16e-instruct';
function getGroqModel() {
  return appConfig.groqModel || GROQ_MODEL_DEFAULT;
}

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// ============================================================
//  GOOGLE AUTH
// ============================================================
// Las credenciales se pueden pasar como variable de entorno (Railway/Vercel)
// o como archivo local (desarrollo)
let credentials;
function parseCredentials(raw) {
  const parsed = JSON.parse(raw);
  // Soporta tanto cliente "web" (Render) como "installed" (escritorio local)
  return parsed.web || parsed.installed;
}
if (process.env.GOOGLE_CREDENTIALS) {
  credentials = parseCredentials(process.env.GOOGLE_CREDENTIALS);
} else {
  credentials = parseCredentials(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
}
const oauth2Client = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret,
  REDIRECT_URI
);

function loadToken() {
  try {
    // 1. Variable de entorno GOOGLE_TOKEN (Render / producción)
    if (process.env.GOOGLE_TOKEN) {
      const token = JSON.parse(process.env.GOOGLE_TOKEN);
      oauth2Client.setCredentials(token);
      return true;
    }
    // 2. Archivo local (desarrollo)
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oauth2Client.setCredentials(token);
      return true;
    }
  } catch (e) {}
  return false;
}
loadToken();

// Guardar tokens renovados automáticamente
oauth2Client.on('tokens', (tokens) => {
  try {
    // Fusionar con los credenciales actuales para preservar refresh_token
    const current = oauth2Client.credentials || {};
    const merged = { ...current, ...tokens };
    // Guardar en disco (desarrollo)
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged));
    // Exponer el token actualizado para que el usuario lo copie a Render
    appConfig._latestToken = JSON.stringify(merged);
  } catch (e) {}
});

// ============================================================
//  MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

// ============================================================
//  AUTH ROUTES
// ============================================================
app.get('/auth/status', (req, res) => {
  const creds = oauth2Client.credentials;
  const authenticated = !!(creds && creds.access_token);
  res.json({ authenticated, email: creds?.email || null, name: creds?.name || null });
});

// Devuelve el token actual para pegarlo en la variable GOOGLE_TOKEN de Render
app.get('/auth/token-export', (req, res) => {
  const creds = oauth2Client.credentials;
  if (!creds || !creds.access_token) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  res.json({ token: JSON.stringify(creds) });
});

app.get('/auth/login', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/?auth=error&msg=${encodeURIComponent(error)}`);
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    // Obtener info del usuario
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const info = await oauth2.userinfo.get();
      tokens.email = info.data.email;
      tokens.name = info.data.name;
    } catch (e) {}
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    // En producción, redirigir a la página de exportar token
    const isProd = process.env.NODE_ENV === 'production';
    res.redirect(isProd ? '/?auth=success&showtoken=1' : '/?auth=success');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect(`/?auth=error&msg=${encodeURIComponent(err.message)}`);
  }
});

app.post('/auth/logout', (req, res) => {
  try {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    oauth2Client.setCredentials({});
  } catch (e) {}
  res.json({ success: true });
});

// ============================================================
//  HELPERS
// ============================================================
function decodeClassroomId(id) {
  // Los IDs en las URLs de Classroom a veces están en base64
  // Ej: MTczMzAwMDMyMDky → 173300032092
  if (/^\d+$/.test(id)) return id; // ya es numérico
  try {
    const decoded = Buffer.from(id, 'base64').toString('utf8');
    if (/^\d+$/.test(decoded)) return decoded;
  } catch (e) {}
  return id; // devolver tal cual si no se puede decodificar
}

function parseClassroomUrl(url) {
  const patterns = [
    /\/u\/\d+\/c\/([^\/]+)\/a\/([^\/\?&#]+)/,
    /\/c\/([^\/]+)\/a\/([^\/\?&#]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return {
      courseId: decodeClassroomId(m[1]),
      courseWorkId: decodeClassroomId(m[2]),
    };
  }
  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilename(name) {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50) || 'alumno'
  );
}

function anonymizeStudentFilename(name, index) {
  const safe = String(name || 'archivo');
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 ? safe.slice(dot).replace(/[^.a-zA-Z0-9]/g, '') : '';
  return `entrega_${index + 1}${ext}`;
}

// ============================================================
//  CONFIGURACIÓN (API Keys)
// ============================================================
app.get('/api/config', (req, res) => {
  const groqKey    = getGroqKey();
  const geminiKey  = getGeminiKey();
  res.json({
    provider:        getProvider(),
    hasGroqKey:      !!groqKey,
    groqKeyPreview:  groqKey   ? `${groqKey.slice(0,6)}…${groqKey.slice(-4)}`   : '',
    hasGeminiKey:    !!geminiKey,
    geminiKeyPreview:geminiKey ? `${geminiKey.slice(0,6)}…${geminiKey.slice(-4)}` : '',
    groqModel:       getGroqModel(),
  });
});

app.post('/api/config', express.json(), (req, res) => {
  const { groqApiKey, geminiApiKey, aiProvider, groqModel } = req.body;
  if (groqApiKey   !== undefined) appConfig.groqApiKey   = groqApiKey.trim();
  if (geminiApiKey !== undefined) appConfig.geminiApiKey = geminiApiKey.trim();
  if (aiProvider   !== undefined) appConfig.aiProvider   = aiProvider;
  if (groqModel    !== undefined) appConfig.groqModel    = groqModel.trim();
  saveConfig();
  res.json({ success: true });
});

app.get('/api/ai-config', (req, res) => {
  const provider = getProvider();
  const key = provider === 'groq' ? getGroqKey() : getGeminiKey();
  res.json({
    provider,
    key,          // the actual API key — acceptable for personal teacher tool
    groqModel: getGroqModel(),
  });
});

// ============================================================
//  DIAGNÓSTICO: listar cursos del usuario
// ============================================================
app.get('/api/my-courses', async (req, res) => {
  try {
    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });
    const r = await classroom.courses.list({ teacherId: 'me', pageSize: 50 });
    const courses = (r.data.courses || []).map(c => ({
      id: c.id,
      name: c.name,
      section: c.section || '',
      state: c.courseState,
    }));
    res.json({ courses });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/course-work/:courseId', async (req, res) => {
  try {
    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });
    const r = await classroom.courses.courseWork.list({
      courseId: req.params.courseId,
      pageSize: 100,
    });
    const tasks = (r.data.courseWork || []).map((w) => ({
      id: w.id,
      title: w.title || 'Sin titulo',
      state: w.state || '',
      maxPoints: w.maxPoints ?? null,
      updateTime: w.updateTime || '',
      dueDate: w.dueDate || null,
    })).sort((a, b) => (b.updateTime || '').localeCompare(a.updateTime || ''));
    res.json({ tasks });
  } catch (e) {
    const code = e.code || e.status;
    if (code === 401) return res.status(401).json({ error: 'Sesion expirada. Vuelve a conectar tu cuenta.' });
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
//  CARGAR TAREA
// ============================================================
app.post('/api/load-task', async (req, res) => {
  const { url, courseId: bodyCourseId, courseWorkId: bodyCourseWorkId } = req.body;
  let courseId = bodyCourseId;
  let courseWorkId = bodyCourseWorkId;

  if (url) {
    const parsed = parseClassroomUrl(url);
    if (!parsed) {
      return res.status(400).json({
        error:
          'URL no válida. Debe tener el formato: https://classroom.google.com/c/{cursoId}/a/{tareaId}/details',
      });
    }
    courseId = parsed.courseId;
    courseWorkId = parsed.courseWorkId;
  }

  if (!courseId || !courseWorkId) {
    return res.status(400).json({ error: 'Debes indicar una URL o seleccionar curso y tarea.' });
  }

  try {
    const data = await loadTaskData(courseId, courseWorkId);
    res.json(data);
  } catch (err) {
    console.error('Error al cargar tarea:', err.message);
    if (err.code === 401 || err.status === 401) {
      return res.status(401).json({ error: 'Sesión expirada. Por favor, vuelve a conectar tu cuenta.' });
    }
    res.status(err.status || 500).json({
      error: err.message,
      courseId: err.courseId,
      courseWorkId: err.courseWorkId,
    });
  }
});

async function loadTaskData(courseId, courseWorkId) {
  const classroom = google.classroom({ version: 'v1', auth: oauth2Client });
  // Primero verificamos acceso al curso
  let courseRes;
  try {
    courseRes = await classroom.courses.get({ id: courseId });
  } catch (e) {
    const code = e.code || e.status;
    if (code === 404) {
      let courseList = [];
      try {
        const listRes = await classroom.courses.list({ teacherId: 'me', pageSize: 20 });
        courseList = (listRes.data.courses || []).map(c => c.name);
      } catch (_) {}
      const err = new Error(
        `Curso no encontrado (ID: ${courseId}). Posibles causas:\n` +
        `1. Iniciaste sesión con una cuenta distinta a la del curso.\n` +
        `2. No eres profesor de este curso.\n` +
        (courseList.length ? `Cursos encontrados en tu cuenta: ${courseList.join(', ')}` : '')
      );
      err.status = 404;
      err.courseId = courseId;
      err.courseWorkId = courseWorkId;
      throw err;
    }
    throw e;
  }

  // Luego la tarea
  let workRes;
  try {
    workRes = await classroom.courses.courseWork.get({ courseId, id: courseWorkId });
  } catch (e) {
    const code = e.code || e.status;
    if (code === 404) {
      const err = new Error(
        `Tarea no encontrada en el curso "${courseRes.data.name}" (ID tarea: ${courseWorkId}).\n` +
        `El curso sí existe pero no se encontró esa tarea. Asegúrate de copiar la URL completa desde la barra del navegador.`
      );
      err.status = 404;
      err.courseId = courseId;
      err.courseWorkId = courseWorkId;
      throw err;
    }
    throw e;
  }

  const submissionsRes = await classroom.courses.courseWork.studentSubmissions.list({
    courseId,
    courseWorkId,
    pageSize: 100,
  });

  const rawSubmissions = submissionsRes.data.studentSubmissions || [];

  let studentMap = {};
  try {
    const studentsRes = await classroom.courses.students.list({ courseId, pageSize: 200 });
    (studentsRes.data.students || []).forEach((s) => {
      studentMap[s.userId] = {
        name: s.profile?.name?.fullName || s.profile?.name?.givenName || 'Alumno',
        email: s.profile?.emailAddress || '',
        photo: s.profile?.photoUrl || '',
      };
    });
  } catch (e) {
    console.warn('No se pudo obtener la lista de alumnos:', e.message);
  }

  const submissions = rawSubmissions.map((s) => {
    const student = studentMap[s.userId] || { name: `Alumno_${s.userId.slice(-5)}`, email: '' };
    const attachments = s.assignmentSubmission?.attachments || [];
    const driveFiles = attachments
      .filter((a) => a.driveFile)
      .map((a) => ({
        id: a.driveFile.driveFile?.id || a.driveFile.id,
        title: a.driveFile.driveFile?.title || a.driveFile.title || 'Archivo',
      }))
      .filter((f) => f.id);

    return {
      id: s.id,
      studentId: s.userId,
      studentName: student.name,
      studentEmail: student.email,
      state: s.state,
      late: s.late || false,
      driveFiles,
      hasSubmission: driveFiles.length > 0,
    };
  });

  submissions.sort((a, b) => {
    if (a.hasSubmission !== b.hasSubmission) return b.hasSubmission - a.hasSubmission;
    return a.studentName.localeCompare(b.studentName, 'es');
  });

  return {
    courseId,
    courseWorkId,
    course: courseRes.data.name,
    task: workRes.data.title,
    description: workRes.data.description || '',
    maxPoints: workRes.data.maxPoints,
    submissions,
  };
}

// ============================================================
//  DESCARGAR ARCHIVO DE DRIVE
// ============================================================
async function downloadDriveFile(fileId) {
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const meta = await drive.files.get({
    fileId,
    // owners y lastModifyingUser nos dan el nombre real del alumno
    fields: 'name,mimeType,owners,lastModifyingUser,modifiedTime',
    supportsAllDrives: true,
  });

  let { name, mimeType } = meta.data;

  // Intentar obtener nombre real del propietario del archivo
  const ownerName =
    meta.data.owners?.[0]?.displayName ||
    meta.data.lastModifyingUser?.displayName ||
    null;
  const ownerEmail =
    meta.data.owners?.[0]?.emailAddress ||
    meta.data.lastModifyingUser?.emailAddress ||
    null;

  let buffer;

  const EXPORT_AS_PDF = [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.presentation',
    'application/vnd.google-apps.drawing',
  ];

  if (EXPORT_AS_PDF.includes(mimeType)) {
    const res = await drive.files.export(
      { fileId, mimeType: 'application/pdf', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    buffer = Buffer.from(res.data);
    mimeType = 'application/pdf';
  } else {
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    buffer = Buffer.from(res.data);
  }

  // Normalizar tipo MIME para imágenes HEIC
  if (mimeType === 'image/heic' || mimeType === 'image/heif') mimeType = 'image/jpeg';

  return { name, mimeType, buffer, ownerName, ownerEmail };
}

/** Decide si un nombre de alumno es genérico (placeholder) */
function isGenericName(name) {
  return !name || /^alumno_?\d*/i.test(name.trim());
}

// ============================================================
//  GROQ API  (ultra-rápida, gratuita, compatible OpenAI)
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Extrae texto de un PDF. Devuelve '' si es un PDF escaneado sin texto. */
async function extractPdfText(buffer) {
  if (!pdfParse) return '';
  try {
    const data = await pdfParse(buffer);
    return (data.text || '').trim();
  } catch (e) {
    console.warn('pdf-parse error:', e.message);
    return '';
  }
}

/**
 * Comprime una imagen para que quepa dentro del límite de Groq (4 MB en base64).
 * Redimensiona a máx 1200 px y calidad 82. Sin sharp devuelve el buffer original.
 */
async function compressImage(buffer, mimeType) {
  if (!sharp) return { buffer, mimeType };
  try {
    const sizeMB = buffer.length / 1024 / 1024;
    // Comprimir siempre: reduce tokens y evita límites TPM de Gemini.
    // Solo saltamos si ya es muy pequeña (< 100 KB) y es JPEG/PNG.
    const alreadyTiny = sizeMB < 0.1 && (mimeType === 'image/jpeg' || mimeType === 'image/png');
    if (alreadyTiny) return { buffer, mimeType };
    const compressed = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    console.log(`Imagen comprimida: ${sizeMB.toFixed(2)} MB → ${(compressed.length/1024/1024).toFixed(2)} MB`);
    return { buffer: compressed, mimeType: 'image/jpeg' };
  } catch (e) {
    console.warn('Error comprimiendo imagen:', e.message);
    return { buffer, mimeType };
  }
}

async function callGroq(prompt, files, attempt = 1, onRetry = null) {
  const MAX_ATTEMPTS = 4;
  const groqKey = getGroqKey();
  if (!groqKey) throw new Error('Falta la API Key de Groq. Configúrala en ⚙️ Ajustes.');

  // Construir el contenido multimodal (OpenAI format)
  const content = [{ type: 'text', text: prompt }];

  for (const file of files) {
    if (file.mimeType.startsWith('image/')) {
      // Comprimir antes de enviar (límite Groq: 4 MB en base64)
      const { buffer: imgBuf, mimeType: imgMime } = await compressImage(file.buffer, file.mimeType);
      const b64SizeMB = (imgBuf.length * 4 / 3) / 1024 / 1024;
      if (b64SizeMB > 4) {
        console.warn(`Imagen aún grande tras compresión (${b64SizeMB.toFixed(1)} MB base64), omitiendo: ${file.name}`);
        continue; // Groq rechaza imágenes base64 > 4 MB
      }
      content.push({
        type: 'image_url',
        image_url: { url: `data:${imgMime};base64,${imgBuf.toString('base64')}` },
      });
    } else if (file.mimeType === 'application/pdf') {
      // Intentar extraer texto del PDF
      const pdfText = await extractPdfText(file.buffer);
      if (pdfText && pdfText.length > 50) {
        content.push({
          type: 'text',
          text: `\n--- PDF: "${file.name}" ---\n${pdfText}\n--- Fin del PDF ---`,
        });
      } else {
        // PDF escaneado sin texto → intentar como imagen (primera página conceptualmente)
        // Al no poder convertirlo, informamos a la IA
        content.push({
          type: 'text',
          text: `\n[El archivo "${file.name}" es un PDF escaneado. Corrígelo según lo que puedas inferir del contexto.]`,
        });
      }
    } else if (file.mimeType === 'text/plain') {
      content.push({ type: 'text', text: `\n--- ${file.name} ---\n${file.buffer.toString('utf8')}` });
    }
  }

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: getGroqModel(),
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 4096,
      },
      {
        headers: {
          Authorization: `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    );

    const text = response.data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Respuesta vacía de Groq');
    try {
      return JSON.parse(text);
    } catch (e) {
      const match = text.match(/```json\n?([\s\S]+?)\n?```/);
      if (match) return JSON.parse(match[1]);
      return { raw: text, nota: null };
    }

  } catch (err) {
    const status = err.response?.status;

    if (status === 429 && attempt <= MAX_ATTEMPTS) {
      const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '0');
      // Si Groq pide esperar más de 60s es que la cuota diaria está agotada → error inmediato
      if (retryAfter > 60) {
        const minutosReset = Math.ceil(retryAfter / 60);
        throw new Error(
          `Cuota diaria de Groq agotada. Reinicia en ~${minutosReset} min, ` +
          `o cambia el modelo en ⚙️ Ajustes a "llama-3.2-11b-vision-preview".`
        );
      }
      const waitSec = retryAfter > 0 ? retryAfter : 10 * attempt;
      console.log(`Groq 429 — reintento ${attempt}/${MAX_ATTEMPTS} en ${waitSec}s`);
      if (onRetry) onRetry({ attempt, max: MAX_ATTEMPTS, wait: waitSec });
      await sleep(waitSec * 1000);
      return callGroq(prompt, files, attempt + 1, onRetry);
    }

    if (status === 401) throw new Error('API Key de Groq inválida. Revisa la configuración.');
    if (status === 400) {
      const msg = err.response?.data?.error?.message || JSON.stringify(err.response?.data);
      throw new Error(`Error Groq (400): ${msg}`);
    }
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Error de Groq: ${msg}`);
  }
}

// ============================================================
//  GEMINI API  (gemini-3.1-flash-lite-preview, segun cuota disponible del proyecto)
// ============================================================

// Proactive rate-limiter: ensures at least MIN_GAP_MS between consecutive
// Gemini requests so we don't burst into the configured RPM limit.
let lastGeminiCallAt = 0;
const GEMINI_MIN_GAP_MS = 4000; // conservative: ≤15 req/min

async function callGemini(prompt, files, attempt = 1, onRetry = null) {
  const MAX_ATTEMPTS = 5;
  const key = getGeminiKey();
  if (!key) throw new Error('Falta la API Key de Gemini. Configúrala en ⚙️ Ajustes.');

  const parts = [{ text: prompt }];

  for (const file of files) {
    if (file.mimeType.startsWith('image/')) {
      const { buffer: imgBuf, mimeType: imgMime } = await compressImage(file.buffer, file.mimeType);
      parts.push({ inline_data: { mime_type: imgMime, data: imgBuf.toString('base64') } });
    } else if (file.mimeType === 'application/pdf') {
      // Gemini soporta PDF nativo — no hace falta extraer texto
      parts.push({ inline_data: { mime_type: 'application/pdf', data: file.buffer.toString('base64') } });
    } else if (file.mimeType === 'text/plain') {
      parts.push({ text: `\n--- ${file.name} ---\n${file.buffer.toString('utf8')}` });
    }
  }

  // ── Proactive throttle ──────────────────────────────────────
  // Only on the first attempt; retries have their own wait above.
  if (attempt === 1) {
    const gap = Date.now() - lastGeminiCallAt;
    if (gap < GEMINI_MIN_GAP_MS) await sleep(GEMINI_MIN_GAP_MS - gap);
  }
  lastGeminiCallAt = Date.now();
  // ─────────────────────────────────────────────────────────────

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
      {
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      },
      { timeout: 90000 }
    );
    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Respuesta vacía de Gemini');
    try { return JSON.parse(text); }
    catch (e) {
      const m = text.match(/```json\n?([\s\S]+?)\n?```/);
      if (m) return JSON.parse(m[1]);
      return { raw: text, nota: null };
    }
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 && attempt <= MAX_ATTEMPTS) {
      const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '0');
      // Log full error body to Render logs for diagnosis
      console.warn('Gemini 429 body:', JSON.stringify(err.response?.data || {}));
      if (retryAfter > 300) throw new Error(`Cuota diaria de Gemini agotada. Reinicia en ~${Math.ceil(retryAfter/60)} min.`);
      // Wait at least 90s: Gemini sliding window can span longer than 60s
      const waitSec = Math.max(retryAfter > 0 ? retryAfter : 0, 90);
      if (onRetry) onRetry({ attempt, max: MAX_ATTEMPTS, wait: waitSec });
      await sleep(waitSec * 1000);
      lastGeminiCallAt = Date.now(); // reset throttle after the long wait
      return callGemini(prompt, files, attempt + 1, onRetry);
    }
    if (status === 401) throw new Error('API Key de Gemini inválida. Revisa la configuración.');
    const geminiMsg = err.response?.data?.error?.message || err.message;
    console.error('Gemini error:', status, geminiMsg);
    throw new Error(`Error de Gemini: ${geminiMsg}`);
  }
}

// ============================================================
//  LLAMADA UNIFICADA — delega a Gemini o Groq según config
// ============================================================
async function callAI(prompt, files, onRetry = null) {
  const provider = getProvider();
  if (provider === 'groq') {
    if (!getGroqKey()) throw new Error('Falta la API Key de Groq. Añade GROQ_API_KEY en las variables de entorno de Render.');
    return callGroq(prompt, files, 1, onRetry);
  }
  if (!getGeminiKey()) throw new Error('Falta la API Key de Gemini. Añade GEMINI_API_KEY en las variables de entorno de Render (no basta con guardarla en ⚙️ Ajustes).');
  return callGemini(prompt, files, 1, onRetry);
}

// ============================================================
//  PROMPT DE CORRECCIÓN
// ============================================================
function buildPrompt(taskName, courseName, instructions, numRef, numStudent) {
  let p = `Eres un profesor experto. Debes corregir la entrega del alumno para la tarea "${taskName}" del curso "${courseName}".\n\n`;

  if (numRef > 0) {
    p += `Los primeros ${numRef} archivo(s) adjunto(s) son el MATERIAL DE REFERENCIA del profesor (rúbrica, solución, criterios de evaluación).\nLos siguientes ${numStudent} archivo(s) son la ENTREGA DEL ALUMNO.\n\n`;
  } else {
    p += `Los ${numStudent} archivo(s) adjunto(s) son la ENTREGA DEL ALUMNO. Corrígela con criterio pedagógico.\n\n`;
  }

  if (instructions?.trim()) {
    p += `INSTRUCCIONES ESPECÍFICAS DEL PROFESOR:\n${instructions.trim()}\n\n`;
  }

  p += `Analiza el trabajo minuciosamente y responde ÚNICAMENTE con un objeto JSON con esta estructura exacta:

{
  "nota": <número decimal entre 0.0 y 10.0>,
  "nota_justificacion": "<justificación breve de la nota>",
  "evaluacion_general": "<párrafo de evaluación general del trabajo>",
  "puntos_fuertes": ["<punto 1>", "<punto 2>", ...],
  "aspectos_mejora": ["<aspecto 1>", "<aspecto 2>", ...],
  "errores_graves": ["<error importante>", ...],
  "correccion_detallada": "<análisis detallado sección por sección o pregunta por pregunta>",
  "feedforward": "<recomendaciones concretas y accionables para mejorar>"
}

REGLAS IMPORTANTES:
- "nota" debe ser un número (ej: 7.5), no una cadena
- Si el trabajo no puede evaluarse, "nota" debe ser null
- Sé específico, constructivo y motivador
- Responde SIEMPRE en español
- Responde ÚNICAMENTE con el JSON, sin texto antes ni después`;

  return p;
}

// ============================================================
//  GENERAR HTML DE CORRECCIÓN
// ============================================================
function generateCorrectionHTML(studentName, taskName, courseName, correction, date) {
  const nota = correction.nota;
  const notaStr = nota !== null && nota !== undefined ? Number(nota).toFixed(1) : '—';
  const notaColor = nota === null ? '#64748b' : nota >= 7 ? '#16a34a' : nota >= 5 ? '#d97706' : '#dc2626';
  const notaLabel =
    nota === null
      ? 'Sin calificar'
      : nota >= 9
      ? 'Excelente'
      : nota >= 7
      ? 'Notable'
      : nota >= 5
      ? 'Aprobado'
      : 'Suspenso';

  const listHtml = (arr, cls) => {
    if (!arr || !arr.length) return `<li class="${cls}">—</li>`;
    return arr.map((item) => `<li class="${cls}">${escapeHtml(item)}</li>`).join('');
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Corrección: ${escapeHtml(studentName)}</title>
<style>
  :root{--blue:#2563eb;--green:#16a34a;--amber:#d97706;--red:#dc2626;--gray:#64748b}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#1e293b;line-height:1.65}
  .header{background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);color:#fff;padding:2.5rem 2rem}
  .header-inner{max-width:820px;margin:0 auto}
  .breadcrumb{font-size:.8rem;opacity:.75;margin-bottom:.4rem}
  .header h1{font-size:1.55rem;font-weight:700;margin-bottom:.3rem}
  .header .alumno{font-size:1.05rem;opacity:.9;margin-bottom:1.25rem}
  .grade-box{display:inline-flex;align-items:center;gap:1rem;background:rgba(255,255,255,.15);backdrop-filter:blur(8px);border-radius:.875rem;padding:.75rem 1.5rem}
  .grade-num{font-size:2.75rem;font-weight:900;color:${notaColor};background:#fff;padding:.2rem .75rem;border-radius:.5rem;min-width:90px;text-align:center}
  .grade-meta .over{font-size:.85rem;opacity:.8}
  .grade-meta .label{font-size:1rem;font-weight:700;color:#fff}
  .container{max-width:820px;margin:2rem auto;padding:0 1rem}
  .card{background:#fff;border-radius:1rem;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .card-title{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:1rem;display:flex;align-items:center;gap:.4rem}
  .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem}
  .meta-item{background:#f8fafc;border-radius:.5rem;padding:.6rem .75rem}
  .meta-item .lbl{font-size:.7rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
  .meta-item .val{font-weight:600;font-size:.9rem;margin-top:.1rem}
  .text-block{font-size:.9rem;color:#334155;white-space:pre-wrap}
  .bg-gray{background:#f8fafc;padding:1rem;border-radius:.5rem;border:1px solid #e2e8f0}
  .bg-blue{background:#eff6ff;padding:1rem;border-radius:.5rem;border:1px solid #bfdbfe}
  .tag{display:inline-block;font-size:.75rem;font-weight:600;padding:.2rem .6rem;border-radius:2rem;margin:.15rem}
  ul.feedback-list{list-style:none}
  ul.feedback-list li{padding:.6rem .875rem;margin-bottom:.4rem;border-radius:.5rem;font-size:.875rem;position:relative;padding-left:1.75rem}
  ul.feedback-list li::before{content:'';position:absolute;left:.75rem;top:.85rem;width:.5rem;height:.5rem;border-radius:50%}
  .li-green{background:#f0fdf4;color:#166534;border-left:3px solid #16a34a}
  .li-green::before{background:#16a34a}
  .li-amber{background:#fff7ed;color:#92400e;border-left:3px solid #d97706}
  .li-amber::before{background:#d97706}
  .li-red{background:#fef2f2;color:#991b1b;border-left:3px solid #dc2626}
  .li-red::before{background:#dc2626}
  .justif{font-size:.8rem;color:#64748b;font-style:italic;margin-top:.75rem;background:#f8fafc;padding:.6rem;border-radius:.4rem}
  .print-btn{display:block;width:100%;padding:1rem;background:var(--blue);color:#fff;border:none;border-radius:.75rem;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s}
  .print-btn:hover{background:#1d4ed8}
  @media print{
    body{background:#fff}
    .card{box-shadow:none;border:1px solid #e2e8f0;page-break-inside:avoid}
    .no-print{display:none}
    .header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <div class="breadcrumb">${escapeHtml(courseName)} &mdash; ${date}</div>
    <h1>${escapeHtml(taskName)}</h1>
    <div class="alumno">Alumno/a: <strong>${escapeHtml(studentName)}</strong></div>
    <div class="grade-box">
      <div class="grade-num">${notaStr}</div>
      <div class="grade-meta">
        <div class="over">sobre 10 puntos</div>
        <div class="label">${notaLabel}</div>
      </div>
    </div>
  </div>
</div>

<div class="container">

  <div class="card">
    <div class="card-title" style="color:#2563eb">📋 Información de la corrección</div>
    <div class="meta-grid">
      <div class="meta-item"><div class="lbl">Curso</div><div class="val">${escapeHtml(courseName)}</div></div>
      <div class="meta-item"><div class="lbl">Tarea</div><div class="val">${escapeHtml(taskName)}</div></div>
      <div class="meta-item"><div class="lbl">Alumno/a</div><div class="val">${escapeHtml(studentName)}</div></div>
      <div class="meta-item"><div class="lbl">Fecha</div><div class="val">${date}</div></div>
      <div class="meta-item"><div class="lbl">Nota</div><div class="val" style="color:${notaColor};font-size:1.1rem;font-weight:800">${notaStr}/10</div></div>
    </div>
  </div>

  <div class="card">
    <div class="card-title" style="color:#2563eb">📊 Evaluación general</div>
    <p class="text-block">${escapeHtml(correction.evaluacion_general || 'No disponible')}</p>
    ${correction.nota_justificacion ? `<div class="justif">💡 Justificación: ${escapeHtml(correction.nota_justificacion)}</div>` : ''}
  </div>

  <div class="card">
    <div class="card-title" style="color:#16a34a">✅ Puntos fuertes</div>
    <ul class="feedback-list">${listHtml(correction.puntos_fuertes, 'li-green')}</ul>
  </div>

  <div class="card">
    <div class="card-title" style="color:#d97706">⚠️ Aspectos a mejorar</div>
    <ul class="feedback-list">${listHtml(correction.aspectos_mejora, 'li-amber')}</ul>
  </div>

  ${
    correction.errores_graves && correction.errores_graves.length
      ? `<div class="card">
    <div class="card-title" style="color:#dc2626">❌ Errores importantes</div>
    <ul class="feedback-list">${listHtml(correction.errores_graves, 'li-red')}</ul>
  </div>`
      : ''
  }

  <div class="card">
    <div class="card-title" style="color:#1e293b">🔍 Corrección detallada</div>
    <div class="text-block bg-gray">${escapeHtml(correction.correccion_detallada || 'No disponible')}</div>
  </div>

  <div class="card">
    <div class="card-title" style="color:#2563eb">🚀 Feedforward &mdash; Cómo mejorar</div>
    <div class="text-block bg-blue">${escapeHtml(correction.feedforward || 'No disponible')}</div>
  </div>

  <div class="card no-print">
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir o guardar como PDF</button>
  </div>

</div>
</body>
</html>`;
}

// ============================================================
//  CORRECCIÓN (SSE streaming)
// ============================================================
app.post('/api/correct', upload.array('referenceFiles', 10), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
    } catch (e) {}
  };

  // Keep-alive: prevents Render's reverse proxy from cutting the connection
  // during long AI calls (proxy drops idle HTTP connections after ~60s)
  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); if (res.flush) res.flush(); } catch (e) {}
  }, 15000);

  try {
    const { courseId, courseWorkId, taskName, courseName, instructions } = req.body;
    const submissions = JSON.parse(req.body.submissionsJson || '[]');
    const referenceFiles = (req.files || []).map((f) => ({
      name: f.originalname,
      mimeType: f.mimetype,
      buffer: f.buffer,
    }));

    const toCorrect = submissions.filter((s) => s.driveFiles?.length > 0);
    const noSubmission = submissions.filter((s) => !s.driveFiles?.length);

    send('start', {
      total: toCorrect.length,
      noSubmission: noSubmission.length,
      message: `Iniciando corrección de ${toCorrect.length} entregas…`,
    });

    // Directorio de salida
    const dirName = `${courseId}_${courseWorkId}`;
    const outputDir = path.join(__dirname, 'correcciones', dirName);
    await fsp.mkdir(outputDir, { recursive: true });

    const date = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const excelRows = [];

    // Sin entrega
    for (const s of noSubmission) {
      excelRows.push({
        Alumno: s.studentName,
        Email: s.studentEmail || '',
        Nota: '',
        Estado: 'Sin entrega',
        'Entregado tarde': s.late ? 'Sí' : 'No',
        'Evaluación general': 'No entregó la tarea',
        'Puntos fuertes': '',
        'Aspectos a mejorar': '',
        Feedforward: '',
        'Archivo HTML': '',
      });
    }

    // Corregir cada alumno
    for (let i = 0; i < toCorrect.length; i++) {
      const sub = toCorrect[i];

      send('progress', {
        current: i + 1,
        total: toCorrect.length,
        student: sub.studentName,
        message: `Descargando archivos de ${sub.studentName}…`,
      });

      try {
        // Descargar archivos del alumno
        const studentFiles = [];
        for (const df of sub.driveFiles) {
          try {
            send('progress', {
              current: i + 1,
              total: toCorrect.length,
              student: sub.studentName,
              message: `Descargando "${df.title}"…`,
            });
            const file = await downloadDriveFile(df.id);
            studentFiles.push(file);

            // ── Nombre real desde el propietario del archivo ──
            // Si el nombre del alumno es genérico (no se obtuvo del roster),
            // usamos el nombre del propietario del archivo en Drive.
            if (isGenericName(sub.studentName) && file.ownerName) {
              const prev = sub.studentName;
              sub.studentName = file.ownerName;
              if (file.ownerEmail && !sub.studentEmail) sub.studentEmail = file.ownerEmail;
              console.log(`Nombre actualizado: "${prev}" → "${sub.studentName}"`);
            }
          } catch (e) {
            send('warning', {
              student: sub.studentName,
              message: `No se pudo descargar "${df.title}": ${e.message}`,
            });
          }
        }

        if (studentFiles.length === 0) {
          throw new Error('No se pudieron descargar los archivos de la entrega');
        }

        send('progress', {
          current: i + 1,
          total: toCorrect.length,
          student: sub.studentName,
          message: `Corrigiendo a ${sub.studentName} con ${getProvider() === 'gemini' ? 'Gemini' : 'Groq'} IA…`,
        });

        // Llamar a Gemini (con callback de reintentos para actualizar el frontend)
        const prompt = buildPrompt(
          taskName,
          courseName,
          instructions,
          referenceFiles.length,
          studentFiles.length
        );
        const allFiles = [...referenceFiles, ...studentFiles];
        const correction = await callAI(prompt, allFiles, ({ attempt, max, wait }) => {
          send('retry', { student: sub.studentName, attempt, max, wait });
        });

        // Generar HTML
        const htmlFilename = `${sanitizeFilename(sub.studentName)}.html`;
        const htmlPath = path.join(outputDir, htmlFilename);
        await fsp.writeFile(
          htmlPath,
          generateCorrectionHTML(sub.studentName, taskName, courseName, correction, date),
          'utf-8'
        );

        // Agregar a Excel
        const nota = correction.nota !== null && correction.nota !== undefined ? Number(correction.nota) : '';
        excelRows.push({
          Alumno: sub.studentName,
          Email: sub.studentEmail || '',
          Nota: nota,
          Estado: sub.state === 'TURNED_IN' ? 'Entregado' : sub.state,
          'Entregado tarde': sub.late ? 'Sí' : 'No',
          'Evaluación general': correction.evaluacion_general || '',
          'Puntos fuertes': (correction.puntos_fuertes || []).join('; '),
          'Aspectos a mejorar': (correction.aspectos_mejora || []).join('; '),
          Feedforward: correction.feedforward || '',
          'Archivo HTML': htmlFilename,
        });

        send('student_done', {
          student: sub.studentName,
          nota,
          htmlFile: `correcciones/${dirName}/${htmlFilename}`,
          summary: (correction.evaluacion_general || '').substring(0, 160),
        });

      } catch (err) {
        console.error(`Error con ${sub.studentName}:`, err.message);
        send('student_error', { student: sub.studentName, error: err.message });
        excelRows.push({
          Alumno: sub.studentName,
          Email: sub.studentEmail || '',
          Nota: '',
          Estado: 'Error',
          'Entregado tarde': sub.late ? 'Sí' : 'No',
          'Evaluación general': `Error: ${err.message}`,
          'Puntos fuertes': '',
          'Aspectos a mejorar': '',
          Feedforward: '',
          'Archivo HTML': '',
        });
      }

      // Pausa entre alumnos — siempre, incluso tras error, para no agotar la cuota
      if (i < toCorrect.length - 1) {
        await sleep(getProvider() === 'gemini' ? 5000 : 2000);
      }
    }

    // ---- Generar Excel ----
    send('progress_general', { message: 'Generando archivo Excel con todas las correcciones…' });

    excelRows.sort((a, b) => a.Alumno.localeCompare(b.Alumno, 'es'));

    const wb = XLSX.utils.book_new();

    // Hoja principal
    const ws = XLSX.utils.json_to_sheet(excelRows);
    ws['!cols'] = [
      { wch: 32 }, { wch: 32 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
      { wch: 60 }, { wch: 50 }, { wch: 50 }, { wch: 60 }, { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Correcciones');

    // Hoja resumen
    const corrected = excelRows.filter((r) => typeof r.Nota === 'number');
    const avg =
      corrected.length > 0
        ? corrected.reduce((s, r) => s + r.Nota, 0) / corrected.length
        : 0;
    const summaryData = [
      { Métrica: 'Total alumnos', Valor: submissions.length },
      { Métrica: 'Entregas corregidas', Valor: corrected.length },
      { Métrica: 'Sin entrega', Valor: noSubmission.length },
      { Métrica: 'Nota media', Valor: avg.toFixed(2) },
      {
        Métrica: 'Nota más alta',
        Valor: corrected.length > 0 ? Math.max(...corrected.map((r) => r.Nota)) : '—',
      },
      {
        Métrica: 'Nota más baja',
        Valor: corrected.length > 0 ? Math.min(...corrected.map((r) => r.Nota)) : '—',
      },
      { Métrica: 'Aprobados (≥5)', Valor: corrected.filter((r) => r.Nota >= 5).length },
      { Métrica: 'Suspensos (<5)', Valor: corrected.filter((r) => r.Nota < 5).length },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen estadístico');

    const excelPath = path.join(outputDir, 'correcciones.xlsx');
    XLSX.writeFile(wb, excelPath);

    send('done', {
      message: '¡Corrección completada!',
      excelFile: `correcciones/${dirName}/correcciones.xlsx`,
      outputDir: `correcciones/${dirName}`,
      stats: {
        total: submissions.length,
        corrected: corrected.length,
        errors: toCorrect.length - corrected.length,
        noSubmission: noSubmission.length,
        average: avg.toFixed(2),
      },
    });
  } catch (err) {
    console.error('Error fatal en corrección:', err);
    send('error', { message: `Error: ${err.message}` });
  }

  clearInterval(keepAlive);
  res.end();
});

// ============================================================
//  BROWSER-SIDE AI — ENDPOINTS DE SOPORTE
// ============================================================

app.post('/api/student-files', express.json({ limit: '2mb' }), async (req, res) => {
  if (!oauth2Client.credentials?.access_token) return res.status(401).json({ error: 'No autenticado con Google' });
  const { submission } = req.body;
  if (!submission) return res.status(400).json({ error: 'Falta submission' });

  let studentName = submission.studentName || 'Alumno';
  let studentEmail = submission.studentEmail || '';
  const files = [];

  for (const df of (submission.driveFiles || [])) {
    try {
      const file = await downloadDriveFile(df.id);

      // Update student name from file owner if generic
      if (isGenericName(studentName) && file.ownerName) {
        studentName = file.ownerName;
        if (file.ownerEmail && !studentEmail) studentEmail = file.ownerEmail;
      }

      let buf = file.buffer;
      let mime = file.mimeType;

      // Compress images
      if (mime.startsWith('image/')) {
        const c = await compressImage(buf, mime);
        buf = c.buffer;
        mime = c.mimeType;
      }

      const entry = {
        name: anonymizeStudentFilename(file.name, files.length),
        mimeType: mime,
        dataBase64: buf.toString('base64'),
      };

      // For PDFs: also extract text (Groq doesn't support PDFs natively)
      if (mime === 'application/pdf') {
        const text = await extractPdfText(buf);
        if (text) entry.extractedText = text;
      }

      files.push(entry);
    } catch (e) {
      console.warn(`No se pudo descargar ${df.title || df.id}:`, e.message);
    }
  }

  res.json({ studentName, studentEmail, files });
});

app.post('/api/save-correction', express.json({ limit: '10mb' }), async (req, res) => {
  const { dirName, studentName, taskName, courseName, correction } = req.body;
  if (!dirName || !studentName || !correction) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }
  try {
    const outputDir = path.join(__dirname, 'correcciones', dirName);
    await fsp.mkdir(outputDir, { recursive: true });
    const htmlFilename = `${sanitizeFilename(studentName)}.html`;
    const htmlPath = path.join(outputDir, htmlFilename);
    const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    await fsp.writeFile(
      htmlPath,
      generateCorrectionHTML(studentName, taskName, courseName, correction, date),
      'utf-8'
    );
    res.json({ htmlFile: `correcciones/${dirName}/${htmlFilename}`, htmlFilename });
  } catch (e) {
    console.error('save-correction error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/finalize-corrections', express.json({ limit: '10mb' }), async (req, res) => {
  const { dirName, rows, totalSubmissions } = req.body;
  if (!dirName || !rows) return res.status(400).json({ error: 'Faltan parámetros' });
  try {
    const outputDir = path.join(__dirname, 'correcciones', dirName);
    await fsp.mkdir(outputDir, { recursive: true });

    const sorted = [...rows].sort((a, b) => a.Alumno.localeCompare(b.Alumno, 'es'));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sorted);
    ws['!cols'] = [
      { wch: 32 }, { wch: 32 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
      { wch: 60 }, { wch: 50 }, { wch: 50 }, { wch: 60 }, { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Correcciones');

    const corrected = sorted.filter(r => typeof r.Nota === 'number');
    const avg = corrected.length > 0 ? corrected.reduce((s, r) => s + r.Nota, 0) / corrected.length : 0;
    const summaryData = [
      { Métrica: 'Total alumnos', Valor: totalSubmissions || sorted.length },
      { Métrica: 'Entregas corregidas', Valor: corrected.length },
      { Métrica: 'Sin entrega / Error', Valor: (totalSubmissions || sorted.length) - corrected.length },
      { Métrica: 'Nota media', Valor: avg.toFixed(2) },
      { Métrica: 'Nota más alta', Valor: corrected.length > 0 ? Math.max(...corrected.map(r => r.Nota)) : '—' },
      { Métrica: 'Nota más baja', Valor: corrected.length > 0 ? Math.min(...corrected.map(r => r.Nota)) : '—' },
      { Métrica: 'Aprobados (≥5)', Valor: corrected.filter(r => r.Nota >= 5).length },
      { Métrica: 'Suspensos (<5)', Valor: corrected.filter(r => r.Nota < 5).length },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen estadístico');

    const excelPath = path.join(outputDir, 'correcciones.xlsx');
    XLSX.writeFile(wb, excelPath);

    res.json({
      excelFile: `correcciones/${dirName}/correcciones.xlsx`,
      outputDir: `correcciones/${dirName}`,
    });
  } catch (e) {
    console.error('finalize-corrections error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
//  SERVIR Y DESCARGAR ARCHIVOS GENERADOS
// ============================================================
app.use('/correcciones', express.static(path.join(__dirname, 'correcciones')));

app.get('/api/files/:courseId/:workId', async (req, res) => {
  const dir = path.join(__dirname, 'correcciones', `${req.params.courseId}_${req.params.workId}`);
  try {
    const files = await fsp.readdir(dir);
    res.json({ files });
  } catch (e) {
    res.json({ files: [] });
  }
});

// Descarga de un único archivo (force-download)
app.get('/api/download-file', async (req, res) => {
  const filePath = path.join(__dirname, decodeURIComponent(req.query.path || ''));
  // Seguridad: solo dentro de correcciones/
  if (!filePath.startsWith(path.join(__dirname, 'correcciones'))) {
    return res.status(403).send('Forbidden');
  }
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.download(filePath);
});

// Descarga ZIP de toda la carpeta de correcciones de una tarea
app.get('/api/download-zip/:courseId/:workId', async (req, res) => {
  const dirName = `${req.params.courseId}_${req.params.workId}`;
  const dir = path.join(__dirname, 'correcciones', dirName);

  if (!fs.existsSync(dir)) {
    return res.status(404).json({ error: 'Carpeta no encontrada' });
  }

  const zipName = `correcciones_${dirName}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => { console.error('ZIP error:', err); res.end(); });
  archive.pipe(res);
  archive.directory(dir, dirName);  // dentro del ZIP todo va en la subcarpeta
  await archive.finalize();
});

// ============================================================
//  INICIO
// ============================================================
async function ensureDirs() {
  await fsp.mkdir(path.join(__dirname, 'correcciones'), { recursive: true });
  await fsp.mkdir(path.join(__dirname, 'public'), { recursive: true });
}

ensureDirs().then(() => {
  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║         CORRECTOR IA — Google Classroom          ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  ✅ Servidor corriendo en http://localhost:${PORT}   ║`);
    console.log('╚══════════════════════════════════════════════════╝');

    // Chequeo de variables de entorno al arrancar
    const provider = getProvider();
    console.log(`\n  Proveedor IA : ${provider.toUpperCase()}`);
    if (provider === 'gemini') {
      if (getGeminiKey()) console.log('  Gemini key   : ✅ configurada');
      else console.warn('  Gemini key   : ⚠️  FALTA — añade GEMINI_API_KEY en Render');
    } else {
      if (getGroqKey()) console.log('  Groq key     : ✅ configurada');
      else console.warn('  Groq key     : ⚠️  FALTA — añade GROQ_API_KEY en Render');
    }
    if (!process.env.GOOGLE_CREDENTIALS) console.warn('  Google creds : ⚠️  FALTA — añade GOOGLE_CREDENTIALS en Render');
    else console.log('  Google creds : ✅ configuradas');
    console.log('');
  });
});
