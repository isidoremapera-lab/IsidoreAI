import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 10000);

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

const API_KEY = process.env.GEMINI_API_KEY;

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_VERSION = "ISIDORE-AI-IMAGES-001";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const SYSTEM_INSTRUCTION = `
Tu es IsidoreAI, un assistant intelligent généraliste,
pédagogique et fiable.

Tu réponds principalement en français, sauf si l'utilisateur
demande explicitement une autre langue.

Tu aides en mathématiques, sciences, éducation, informatique,
mécanique, électricité, économie, langues, histoire,
géographie, commerce et culture générale.

Utilise le contexte de la conversation pour comprendre
les demandes courtes et les questions de suivi.

Si une image est jointe, analyse-la attentivement.
Ne prétends pas avoir créé ou modifié une image si cela
n'a pas réellement été effectué par le service d'images.

Pour les exercices scientifiques, présente les données,
les formules, les calculs et les résultats avec leurs unités.

Réponds clairement et ne fabrique pas de faits.
`;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

if (!API_KEY) {
  console.error(
    "ERREUR : GEMINI_API_KEY est absente. Configurez-la dans Render."
  );

  process.exit(1);
}

function sendJSON(res, status, data) {
  if (res.writableEnded || res.destroyed) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
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

        reject(
          new Error(
            "Requête trop volumineuse. Réduisez la taille de l'image."
          )
        );

        req.resume();
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (finished) return;

      finished = true;
      resolve(body);
    });

    req.on("error", error => {
      if (finished) return;

      finished = true;
      reject(error);
    });
  });
}

function validateImage(image) {
  if (!image) return null;

  const mimeType = image.mimeType;
  const data = image.data;

  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error(
      "Format non pris en charge. Utilisez JPG, PNG ou WEBP."
    );
  }

  if (
    typeof data !== "string" ||
    !data ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    throw new Error("Les données de l'image sont invalides.");
  }

  const estimatedBytes = Math.floor(data.length * 3 / 4);

  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error("L'image dépasse la limite de 5 Mo.");
  }

  return { mimeType, data };
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const clean = [];

  for (const message of history.slice(-16)) {
    if (
      !message ||
      !["user", "assistant", "model"].includes(message.role) ||
      typeof message.text !== "string"
    ) {
      continue;
    }

    const text = message.text.trim().slice(0, 4000);

    if (!text) continue;

    const role =
      message.role === "assistant" ? "model" : message.role;

    const previous = clean[clean.length - 1];

    if (previous && previous.role === role) {
      previous.parts.push({ text });
    } else {
      clean.push({
        role,
        parts: [{ text }]
      });
    }
  }

  while (clean.length && clean[0].role !== "user") {
    clean.shift();
  }

  return clean;
}

async function callGeminiChat(problem, image, history = []) {
  const contents = sanitizeHistory(history);

  const parts = [
    {
      text: problem ||
        "Analyse cette image et explique ce qu'elle montre."
    }
  ];

  if (image) {
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.data
      }
    });
  }

  const previous = contents[contents.length - 1];

  if (previous && previous.role === "user") {
    previous.parts.push(...parts);
  } else {
    contents.push({
      role: "user",
      parts
    });
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(GEMINI_MODEL) +
      ":generateContent",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },

      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },

        contents,

        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 3000
        }
      }),

      signal: AbortSignal.timeout(120000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message || "Erreur de l'API Gemini.";

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Accès refusé. Vérifiez GEMINI_API_KEY et les autorisations."
      );
    }

    if (response.status === 404) {
      throw new Error(
        "Modèle de conversation inaccessible : " + GEMINI_MODEL
      );
    }

    
if (response.status === 429) {
  console.error(
    "[ERREUR GEMINI IMAGE 429]",
    JSON.stringify(data, null, 2)
  );

  throw new Error(
    "Google refuse la génération d'images (429). " +
    "Consultez les journaux Render pour connaître " +
    "la cause exacte."
  );
}

    throw new Error(message);
  }

  const answer =
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

  if (!answer) {
    throw new Error(
      "Gemini n'a retourné aucune réponse exploitable."
    );
  }

  return answer;
}

/*
 * Génération et modification d'images.
 *
 * Utilise l'API Interactions de Google.
 * Le modèle d'images est indépendant du modèle de conversation.
 */

async function generateImage(prompt, image, referenceImage) {
  const input = [];

  if (referenceImage) {
    const ref = validateImage(referenceImage);

    input.push({
      type: "image",
      mime_type: ref.mimeType,
      data: ref.data
    });
  }

  if (image) {
    input.push({
      type: "image",
      mime_type: image.mimeType,
      data: image.data
    });
  }

  input.push({
    type: "text",
    text: prompt
  });

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },

      body: JSON.stringify({
        model: GEMINI_IMAGE_MODEL,
        input,
        response_format: [
          { type: "text" },
          { type: "image" }
        ]
      }),

      signal: AbortSignal.timeout(180000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      "Erreur du service de génération d'images.";

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Accès au modèle d'images refusé. Vérifiez votre clé API, " +
        "les autorisations et la facturation."
      );
    }

    if (response.status === 404) {
      throw new Error(
        "Modèle d'images inaccessible : " + GEMINI_IMAGE_MODEL +
        ". Vérifiez son identifiant et son accès dans Google AI Studio."
      );
    }

    if (response.status === 429) {
      throw new Error(
        "Limite de génération d'images atteinte."
      );
    }

    throw new Error(message);
  }

  let outputImage = data?.output_image || null;
  let outputText = data?.output_text || "";

  /*
   * Recherche également l'image dans les étapes de sortie
   * lorsque l'API renvoie une liste de blocs.
   */

  for (const step of data?.steps || []) {
    for (const block of step?.content || []) {
      if (!outputImage && block?.type === "image") {
        outputImage = {
          data: block.data,
          mime_type: block.mime_type
        };
      }

      if (!outputText && block?.type === "text") {
        outputText = block.text || "";
      }
    }
  }

  if (!outputImage?.data) {
    throw new Error(
      "Le modèle n'a renvoyé aucune image. Vérifiez que le modèle " +
      "est accessible à votre compte Gemini."
    );
  }

  return {
    image: {
      data: outputImage.data,
      mimeType:
        outputImage.mime_type ||
        outputImage.mimeType ||
        "image/png"
    },

    text: outputText
  };
}

/*
 * Recherche de photographies réelles.
 *
 * Nécessite Google Custom Search API et un moteur de recherche
 * programmable configuré pour rechercher des images.
 */

async function searchImages(query) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const engineId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !engineId) {
    throw new Error(
      "La recherche d'images n'est pas configurée. " +
      "Ajoutez GOOGLE_CSE_API_KEY et GOOGLE_CSE_ID dans Render."
    );
  }

  const url = new URL(
    "https://www.googleapis.com/customsearch/v1"
  );

  url.search = new URLSearchParams({
    key: apiKey,
    cx: engineId,
    q: query,
    searchType: "image",
    num: "8",
    safe: "active"
  }).toString();

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "La recherche de photographies a échoué."
    );
  }

  const images = (data.items || [])
    .filter(item => /^https?:\/\//i.test(item.link || ""))
    .map(item => ({
      title: item.title || "Photographie",
      imageUrl: item.link,
      thumbnailUrl: item.image?.thumbnailLink || item.link,
      sourceUrl: item.image?.contextLink || item.link,
      width: item.image?.width || null,
      height: item.image?.height || null
    }));

  return images;
}

const server = http.createServer(async (req, res) => {
  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      ).pathname
    );
  } catch {
    sendJSON(res, 400, { error: "Adresse de requête invalide." });
    return;
  }

  /*
   * Vérification de l'état du serveur.
   */

  if (
    req.method === "GET" &&
    (pathname === "/health" || pathname === "/diagnostic")
  ) {
    sendJSON(res, 200, {
      status: "ok",
      service: "IsidoreAI",
      version: SERVER_VERSION,
      model: GEMINI_MODEL,
      imageModel: GEMINI_IMAGE_MODEL,
      imageSearchConfigured: Boolean(
        process.env.GOOGLE_CSE_API_KEY &&
        process.env.GOOGLE_CSE_ID
      ),
      indexExists: fs.existsSync(
        path.join(__dirname, "index.html")
      ),
      node: process.version
    });

    return;
  }

  /*
   * Routes API.
   */

  if (req.method === "POST" && pathname.startsWith("/api/")) {
    let body;

    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message || "Requête JSON invalide."
      });

      return;
    }

    try {
      /*
       * 1. Conversation et analyse des images.
       */

      if (pathname === "/api/solve") {
        const problem =
          typeof body.problem === "string"
            ? body.problem.trim()
            : "";

        const image = validateImage(body.image);

        if (!problem && !image) {
          sendJSON(res, 400, {
            error: "Saisissez une question ou joignez une image."
          });

          return;
        }

        if (problem.length > 20000) {
          sendJSON(res, 400, {
            error: "Votre question est trop longue."
          });

          return;
        }

        const answer = await callGeminiChat(
          problem,
          image,
          body.history
        );

        sendJSON(res, 200, {
          answer,
          model: GEMINI_MODEL,
          server: SERVER_VERSION
        });

        return;
      }

      /*
       * 2. Création et modification d'images.
       */

      if (pathname === "/api/generate-image") {
        const prompt =
          typeof body.prompt === "string"
            ? body.prompt.trim()
            : "";

        const image = validateImage(body.image);
        const referenceImage = body.referenceImage || null;

        if (!prompt && !image && !referenceImage) {
          sendJSON(res, 400, {
            error: "Décrivez l'image à créer ou joignez une photo."
          });

          return;
        }

        const result = await generateImage(
          prompt ||
            "Améliore cette image en conservant son sujet principal.",
          image,
          referenceImage
        );

        sendJSON(res, 200, {
          ...result,
          model: GEMINI_IMAGE_MODEL,
          server: SERVER_VERSION
        });

        return;
      }

      /*
       * 3. Recherche de photographies réelles.
       */

      if (pathname === "/api/search-images") {
        const query =
          typeof body.query === "string"
            ? body.query.trim()
            : "";

        if (!query || query.length > 300) {
          sendJSON(res, 400, {
            error: "Saisissez un sujet de recherche valide."
          });

          return;
        }

        const images = await searchImages(query);

        sendJSON(res, 200, {
          query,
          images,
          server: SERVER_VERSION
        });

        return;
      }

      sendJSON(res, 404, {
        error: "Route API inconnue."
      });

    } catch (error) {
      console.error(
        "ERREUR API :",
        pathname,
        error.message
      );

      sendJSON(res, 502, {
        error:
          error.message ||
          "Le service demandé est temporairement indisponible.",
        server: SERVER_VERSION
      });
    }

    return;
  }

  /*
   * Distribution des fichiers de l'application.
   */

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJSON(res, 405, {
      error: "Méthode HTTP non autorisée."
    });

    return;
  }

  let requestedPath =
    pathname === "/" ? "/index.html" : pathname;

  requestedPath = requestedPath.replace(/^\/+/, "");

  if (
    requestedPath.includes("..") ||
    requestedPath.includes("\\")
  ) {
    res.writeHead(403);
    res.end("Accès interdit.");
    return;
  }

  const rootPath = path.resolve(__dirname);
  const filePath = path.resolve(rootPath, requestedPath);

  if (
    filePath !== rootPath &&
    !filePath.startsWith(rootPath + path.sep)
  ) {
    res.writeHead(403);
    res.end("Accès interdit.");
    return;
  }

  fs.readFile(filePath, (error, fileData) => {
    if (error) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      res.end("Fichier introuvable.");
      return;
    }

    res.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(filePath).toLowerCase()] ||
        "application/octet-stream",

      "Cache-Control": "no-cache",

      "X-Content-Type-Options": "nosniff"
    });

    res.end(req.method === "HEAD" ? undefined : fileData);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("ISIDORE AI EN LIGNE");
  console.log("Version :", SERVER_VERSION);
  console.log("Port :", PORT);
  console.log("Conversation :", GEMINI_MODEL);
  console.log("Images :", GEMINI_IMAGE_MODEL);
  console.log("======================================");
});

server.on("error", error => {
  console.error("ERREUR SERVEUR :", error.message);
});
