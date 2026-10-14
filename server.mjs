import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* CONFIGURATION ISIDORE AI */
const PORT = process.env.PORT || 10000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
const API_KEY = process.env.GEMINI_API_KEY;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_VERSION = "ISIDORE-AI-CONTEXT-006";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_CHARS = 16000;

console.log("==============================================");
console.log("ISIDORE AI - SERVEUR", SERVER_VERSION);
console.log("MODELE :", GEMINI_MODEL);
console.log("DOSSIER :", __dirname);
console.log("==============================================");

if (!API_KEY) {
  console.error("ERREUR : GEMINI_API_KEY est absente. Configurez-la dans Render.");
  process.exit(1);
}

const SYSTEM_INSTRUCTION = `
Tu es Isidore AI, un assistant intelligent généraliste, fiable, pédagogique et attentif au contexte.
Tu réponds principalement en français, sauf si l'utilisateur demande explicitement une autre langue ou écrit clairement dans une autre langue.
Tu aides en mathématiques, sciences, éducation, informatique, mécanique, électricité, économie, langues, histoire, géographie, commerce, rédaction et culture générale.
Comprends l'utilisateur même s'il fait des fautes, oublie des accents, utilise des abréviations ou mélange plusieurs langues.
IMPORTANT : utilise les messages précédents de la conversation pour comprendre les demandes courtes ou dépendantes du contexte comme « continue », « explique davantage », « le niveau d'études », « fais la suite » ou « donne un exemple ». Ne recommence pas par une salutation inutile à chaque message et ne traite pas une précision comme une nouvelle question sans lien avec ce qui précède.
Réponds clairement, précisément et de manière suffisamment détaillée. Structure les réponses avec des titres, étapes, exemples ou tableaux lorsque cela est utile. Pour un problème mathématique ou scientifique, présente les données, l'inconnue, la formule, les étapes de calcul et le résultat avec unité. N'invente pas de faits et signale les incertitudes.
Si l'utilisateur joint une image, observe-la attentivement. Lis le texte visible si possible, décris les éléments pertinents et réponds à la demande en t'appuyant sur l'image. Si le texte ou un détail est illisible, dis-le clairement au lieu de deviner.
Si une demande est ambiguë, utilise le contexte déjà disponible avant de demander une précision.
`;

function sendJSON(res, status, data) {
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let finished = false;
    req.on("data", chunk => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finished = true;
        reject(new Error("Requête trop volumineuse. Réduisez la taille de l’image à 5 Mo maximum."));
        req.resume();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => { if (!finished) { finished = true; resolve(body); } });
    req.on("error", error => { if (!finished) { finished = true; reject(error); } });
  });
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  let remaining = MAX_HISTORY_CHARS;
  const clean = [];
  for (const message of history.slice(-MAX_HISTORY_MESSAGES)) {
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.text !== "string") continue;
    const text = message.text.trim();
    if (!text) continue;
    const clipped = text.slice(0, remaining);
    if (!clipped) break;
    clean.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: clipped }] });
    remaining -= clipped.length;
    if (remaining <= 0) break;
  }
  // Gemini expects alternating user/model turns; discard a leading model turn if present.
  while (clean.length && clean[0].role !== "user") clean.shift();
  // Merge consecutive turns of the same role into one content entry.
  const normalized = [];
  for (const item of clean) {
    const last = normalized[normalized.length - 1];
    if (last && last.role === item.role) last.parts.push(...item.parts);
    else normalized.push(item);
  }
  return normalized;
}

async function askGemini(problem, image = null, history = []) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const currentParts = [{ text: `Réponds à la demande suivante en tenant compte du contexte de la conversation :\n\n${problem}` }];
  if (image) currentParts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  const contents = [...sanitizeHistory(history), { role: "user", parts: currentParts }];
  const requestData = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    generationConfig: { maxOutputTokens: 3000, temperature: 0.3 }
  };
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(120000)
    });
  } catch (error) {
    console.error("Erreur de connexion à Gemini :", error.message);
    throw new Error("Impossible de contacter Gemini. Vérifiez la connexion du serveur.");
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error("Gemini a retourné une réponse illisible."); }
  if (!response.ok) {
    const msg = data?.error?.message || "Erreur inconnue de l'API Gemini.";
    console.error("ERREUR GEMINI :", response.status, msg);
    if (response.status === 400) throw new Error(`Requête refusée par Gemini : ${msg}`);
    if (response.status === 401 || response.status === 403) throw new Error("Accès refusé par Gemini. Vérifiez la clé API et les autorisations.");
    if (response.status === 404) throw new Error(`Modèle Gemini introuvable ou inaccessible : ${GEMINI_MODEL}.`);
    if (response.status === 429) throw new Error("Limite d'utilisation de Gemini atteinte. Réessayez plus tard.");
    if (response.status >= 500) throw new Error("Le service Gemini rencontre un problème temporaire. Réessayez plus tard.");
    throw new Error(`Erreur Gemini (${response.status}) : ${msg}`);
  }
  const answer = data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
  if (!answer) {
    const reason = data?.candidates?.[0]?.finishReason;
    console.error("Gemini n'a retourné aucun texte.", reason || "");
    throw new Error("Gemini n'a retourné aucune réponse exploitable. Reformulez votre question ou essayez une autre image.");
  }
  return answer;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8"
};
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const server = http.createServer(async (req, res) => {
  try {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname); }
    catch { sendJSON(res, 400, { error: "Adresse de requête invalide." }); return; }
    if (req.method === "GET" && pathname === "/health") {
      sendJSON(res, 200, { status: "ok", service: "Isidore AI", version: SERVER_VERSION, model: GEMINI_MODEL }); return;
    }
    if (req.method === "GET" && pathname === "/diagnostic") {
      sendJSON(res, 200, { status: "ok", service: "Isidore AI", server: SERVER_VERSION, model: GEMINI_MODEL, node: process.version,
        indexExists: fs.existsSync(path.join(__dirname, "index.html")),
        manifestExists: fs.existsSync(path.join(__dirname, "manifest.json")),
        iconExists: fs.existsSync(path.join(__dirname, "icon.svg")) }); return;
    }
    if (pathname === "/api/solve" && req.method === "POST") {
      let body;
      try { body = await readBody(req); }
      catch (error) { sendJSON(res, 413, { error: error.message }); return; }
      let data;
      try { data = JSON.parse(body); }
      catch { sendJSON(res, 400, { error: "Requête JSON invalide." }); return; }
      const problem = typeof data?.problem === "string" ? data.problem.trim() : "";
      const incomingImage = data?.image;
      if (!problem && !incomingImage) { sendJSON(res, 400, { error: "Veuillez saisir une question ou joindre une image." }); return; }
      if (problem.length > 20000) { sendJSON(res, 400, { error: "Votre question est trop longue. Veuillez la raccourcir." }); return; }
      let image = null;
      if (incomingImage !== undefined && incomingImage !== null) {
        const mimeType = incomingImage?.mimeType;
        const base64 = incomingImage?.data;
        if (typeof mimeType !== "string" || !allowedImageTypes.has(mimeType)) {
          sendJSON(res, 400, { error: "Format d’image non pris en charge. Utilisez JPG, PNG ou WEBP." }); return;
        }
        if (typeof base64 !== "string" || !base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
          sendJSON(res, 400, { error: "Données de l’image invalides. Veuillez joindre l’image à nouveau." }); return;
        }
        const estimatedBytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
        if (estimatedBytes > MAX_IMAGE_BYTES) { sendJSON(res, 413, { error: "L’image dépasse la limite de 5 Mo." }); return; }
        image = { mimeType, data: base64 };
      }
      // Garder l'historique au format { role, text } jusqu'à askGemini.
      // askGemini appelle sanitizeHistory une seule fois pour convertir les rôles Gemini.
      const history = Array.isArray(data?.history) ? data.history : [];
      const cleanHistory = sanitizeHistory(history);
      console.log("NOUVELLE DEMANDE | texte :", problem.length, "caractères | historique :", cleanHistory.length, "messages | image :", image ? "oui" : "non", "| modèle :", GEMINI_MODEL);
      try {
        const prompt = problem || "Analyse cette image et explique clairement ce qu’elle montre.";
        const answer = await askGemini(prompt, image, history);
        sendJSON(res, 200, { answer, model: GEMINI_MODEL, server: SERVER_VERSION });
      } catch (error) {
        console.error("ERREUR DE TRAITEMENT :", error.message);
        sendJSON(res, 500, { error: error.message, model: GEMINI_MODEL, server: SERVER_VERSION });
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { sendJSON(res, 405, { error: "Méthode HTTP non autorisée." }); return; }
    let requestedPath = pathname;
    if (requestedPath === "/" || requestedPath === "") requestedPath = "/index.html";
    requestedPath = requestedPath.replace(/^\/+/, "");
    if (requestedPath.includes("..") || requestedPath.includes("\\")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Accès interdit."); return;
    }
    const rootPath = path.resolve(__dirname);
    const filePath = path.resolve(rootPath, requestedPath);
    if (filePath !== rootPath && !filePath.startsWith(rootPath + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Accès interdit."); return;
    }
    fs.readFile(filePath, (error, fileData) => {
      if (error) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end("Fichier introuvable."); return; }
      res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
      if (req.method === "HEAD") res.end(); else res.end(fileData);
    });
  } catch (error) {
    console.error("ERREUR SERVEUR :", error.message);
    if (!res.headersSent && !res.destroyed) sendJSON(res, 500, { error: "Une erreur interne est survenue." });
  }
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("==============================================");
  console.log("ISIDORE AI EST EN LIGNE | version :", SERVER_VERSION);
  console.log("PORT :", PORT, "| MODELE :", GEMINI_MODEL);
  console.log("==============================================");
});
server.on("error", error => console.error("ERREUR SERVEUR :", error.message));
