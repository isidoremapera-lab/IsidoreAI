import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHAT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const SYSTEM_INSTRUCTION = `Tu es IsidoreAI-2, un assistant utile, précis et pédagogique. Réponds dans la langue de l'utilisateur, généralement en français. Explique les étapes clairement. Pour les exercices, montre le raisonnement et vérifie les calculs. Si une image est fournie, analyse uniquement ce qui est visible et signale les incertitudes.`;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('La requête est trop volumineuse. Réduisez la taille de l’image.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Le corps de la requête doit être un JSON valide.'); error.status = 400; throw error; }
}

function validateImage(image, label = 'image') {
  if (!image) return null;
  const mimeType = String(image.mimeType || image.mime_type || '');
  const data = String(image.data || '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    const error = new Error(`Format de ${label} non pris en charge. Utilisez JPG, PNG ou WEBP.`); error.status = 400; throw error;
  }
  if (!data || data.length > 18 * 1024 * 1024) {
    const error = new Error(`Les données de ${label} sont absentes ou trop volumineuses.`); error.status = 400; throw error;
  }
  return { mimeType, data };
}

async function geminiRequest(model, body) {
  if (!GEMINI_API_KEY) {
    const error = new Error('La clé GEMINI_API_KEY n’est pas configurée dans les variables d’environnement du serveur Render.');
    error.status = 503; throw error;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const detail = data?.error?.message || `Erreur du service Gemini (HTTP ${response.status}).`;
    const error = new Error(detail); error.status = response.status >= 500 ? 502 : 400; throw error;
  }
  return data;
}

function extractText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .filter(part => typeof part.text === 'string')
    .map(part => part.text).join('\n').trim();
}

async function solve(req, res) {
  const input = await readJson(req);
  const problem = String(input.problem || '').trim();
  if (!problem && !input.image) return sendJson(res, 400, { error: 'Écrivez une question ou joignez une image.' });
  const image = validateImage(input.image);
  const parts = [{ text: problem || 'Analyse cette image et explique clairement ce qu’elle montre.' }];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  const history = Array.isArray(input.history) ? input.history.slice(-16) : [];
  const contents = [];
  for (const item of history) {
    if (!item || !['user', 'assistant', 'model'].includes(item.role) || typeof item.text !== 'string' || !item.text.trim()) continue;
    contents.push({ role: item.role === 'assistant' ? 'model' : item.role, parts: [{ text: item.text.slice(0, 12000) }] });
  }
  contents.push({ role: 'user', parts });
  const data = await geminiRequest(CHAT_MODEL, {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 4096 }
  });
  const answer = extractText(data);
  if (!answer) throw new Error('Gemini n’a renvoyé aucun texte. Vérifiez les limites et le modèle configuré.');
  return sendJson(res, 200, { answer, model: CHAT_MODEL });
}

async function generateImage(req, res) {
  const input = await readJson(req);
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return sendJson(res, 400, { error: 'Décrivez l’image que vous souhaitez créer ou modifier.' });
  if (prompt.length > 8000) return sendJson(res, 400, { error: 'La description est trop longue (maximum 8 000 caractères).' });
  const attached = validateImage(input.image, 'image envoyée');
  const reference = validateImage(input.referenceImage, 'image de référence');
  const parts = [];
  if (attached) parts.push({ inlineData: { mimeType: attached.mimeType, data: attached.data } });
  if (reference && !attached) parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.data } });
  parts.push({ text: (attached || reference)
    ? `Utilise l’image fournie comme référence et applique cette demande. Si la demande est une modification, conserve les éléments non concernés et modifie uniquement ce qui est demandé. Description : ${prompt}`
    : `Génère une image correspondant à cette description. Ne réponds pas uniquement avec des instructions textuelles : produis réellement une image. Description : ${prompt}` });

  const data = await geminiRequest(IMAGE_MODEL, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  });
  const outputParts = data?.candidates?.[0]?.content?.parts || [];
  let text = '';
  let image = null;
  for (const part of outputParts) {
    if (typeof part.text === 'string') text += (text ? '\n' : '') + part.text;
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) image = { mimeType: inline.mimeType || inline.mime_type || 'image/png', data: inline.data };
  }
  if (!image) {
    const blockReason = data?.promptFeedback?.blockReason;
    const error = new Error(blockReason
      ? `La demande d’image a été bloquée par le service (${blockReason}). Reformulez la demande.`
      : (text || 'Le modèle n’a pas renvoyé d’image. Vérifiez que ce modèle est activé pour votre clé API.'));
    error.status = 502; throw error;
  }
  return sendJson(res, 200, { text, image, model: IMAGE_MODEL });
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.resolve(__dirname, `.${requested}`);
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== path.join(__dirname, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  let content;
  try { content = await fs.readFile(filePath); }
  catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Fichier introuvable.'); }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (req.method === 'POST' && pathname === '/api/solve') return await solve(req, res);
    if (req.method === 'POST' && pathname === '/api/generate-image') return await generateImage(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Méthode HTTP non autorisée.' });
    return await serveStatic(req, res);
  } catch (error) {
    console.error('[ISIDORE AI-2]', error);
    if (res.headersSent) return res.end();
    const status = Number(error.status) || 500;
    return sendJson(res, status, { error: error.message || 'Une erreur interne est survenue.' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`IsidoreAI-2 écoute sur le port ${PORT}`));
