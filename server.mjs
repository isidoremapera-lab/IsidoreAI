import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* =====================================================
   CONFIGURATION
===================================================== */

const PORT = process.env.PORT || 10000;

// Le modèle Gemini doit être compatible avec l'API Google Generative AI.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Clé Gemini uniquement côté serveur
const API_KEY = process.env.GEMINI_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/* =====================================================
   IDENTIFICATION DU SERVEUR
===================================================== */

const SERVER_VERSION = "ISIDOREAI-3.5-FIX-002";

console.log("");
console.log("==============================================");
console.log("        ISIDOREAI - SERVEUR");
console.log("==============================================");
console.log("🔥 VERSION :", SERVER_VERSION);
console.log("🧠 MODÈLE  :", GEMINI_MODEL);
console.log("📂 DOSSIER :", __dirname);
console.log("==============================================");
console.log("");


/* =====================================================
   VÉRIFICATION DE LA CLÉ GEMINI
===================================================== */

if (!API_KEY) {

    console.error("");
    console.error("❌ ERREUR : GEMINI_API_KEY est absente.");
    console.error("Configurez GEMINI_API_KEY dans Render.");
    console.error("");

    process.exit(1);
}


/* =====================================================
   INSTRUCTIONS D'ISIDORE
===================================================== */

const SYSTEM_INSTRUCTION = `
Tu es ISIDOREAI, un assistant intelligent généraliste.

Tu réponds principalement en français, sauf si
l'utilisateur demande explicitement une autre langue.

Tu peux répondre dans de nombreux domaines :

- mathématiques ;
- physique ;
- chimie ;
- biologie ;
- médecine générale avec prudence ;
- histoire ;
- géographie ;
- éducation ;
- informatique ;
- programmation ;
- mécanique ;
- automobile ;
- électricité ;
- économie et gestion ;
- droit avec prudence ;
- littérature ;
- langues et traduction ;
- culture générale ;
- technologie ;
- vie quotidienne.

Tu dois comprendre l'utilisateur même lorsqu'il :

- fait des fautes d'orthographe ;
- oublie des accents ;
- écrit rapidement ;
- utilise des abréviations ;
- écrit phonétiquement ;
- mélange plusieurs langues ;
- formule mal sa question.

Réponds de manière claire, structurée et pédagogique.

Pour les problèmes de mathématiques et de sciences :

1. Identifie les données.
2. Identifie ce qui est recherché.
3. Donne la formule utile.
4. Effectue le calcul étape par étape.
5. Donne le résultat final avec son unité lorsque c'est nécessaire.

Pour les questions générales, réponds directement.

Si tu ne connais pas une information ou si elle est
incertaine, indique clairement cette incertitude.

N'invente jamais une information présentée comme un fait.

Pour les sujets sensibles ou à risque, donne des
informations prudentes et recommande une source
professionnelle lorsque cela est nécessaire.

Ton objectif est d'être un assistant généraliste,
utile, précis, pédagogique et compréhensible.
`;


/* =====================================================
   RÉPONSE JSON
===================================================== */

function sendJSON(res, status, data) {

    if (res.headersSent) {
        return;
    }

    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify(data));
}


/* =====================================================
   LECTURE DU CORPS DE LA REQUÊTE
===================================================== */

function readBody(req) {

    return new Promise((resolve, reject) => {

        let body = "";

        req.on("data", chunk => {

            body += chunk;

            if (body.length > 100000) {

                reject(
                    new Error("Requête trop volumineuse.")
                );

                req.destroy();
            }
        });

        req.on("end", () => {
            resolve(body);
        });

        req.on("error", reject);
    });
}


/* =====================================================
   APPEL GEMINI
===================================================== */

async function askGemini(problem) {

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    console.log("");
    console.log("==============================================");
    console.log("🧠 APPEL GEMINI");
    console.log("==============================================");
    console.log("🔥 VERSION SERVEUR :", SERVER_VERSION);
    console.log("🧠 MODÈLE DEMANDÉ  :", GEMINI_MODEL);
    console.log("🌐 URL GEMINI      :", url);
    console.log("==============================================");
    console.log("");

    const body = {
        system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        contents: [{
            role: "user",
            parts: [{ text: `Résous le problème suivant :\n\n${problem}` }]
        }],
        generationConfig: {
            maxOutputTokens: 3000
        }
    };

    let response;

    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": API_KEY
            },
            body: JSON.stringify(body)
        });
    } catch (networkError) {
        throw new Error(`Impossible de contacter Gemini : ${networkError.message}`);
    }

    const data = await response.json();

    if (!response.ok) {
        const message = data?.error?.message || "Erreur inconnue de Gemini.";

        console.error("");
        console.error("❌ GEMINI A REFUSÉ LA REQUÊTE");
        console.error("🧠 Modèle utilisé :", GEMINI_MODEL);
        console.error("❌ Message :", message);
        console.error("");

        throw new Error(message);
    }

    const text = data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!text) {
        throw new Error("Gemini n'a retourné aucune réponse.");
    }

    console.log("✅ Réponse Gemini reçue.");
    console.log("");

    return text;
}


/* =====================================================
   TYPES MIME
===================================================== */

const mimeTypes = {

    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8"

};


/* =====================================================
   SERVEUR HTTP
===================================================== */

const server = http.createServer(async (req, res) => {

    try {

        const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const pathname = decodeURIComponent(requestUrl.pathname);

        /* ========================================
           HEALTH CHECK
        ======================================== */

        if (req.method === "GET" && pathname === "/health") {
            sendJSON(res, 200, {
                status: "ok",
                service: "IsidoreAI",
                version: SERVER_VERSION,
                model: GEMINI_MODEL,
                directory: __dirname
            });
            return;
        }

        /* ========================================
           DIAGNOSTIC
        ======================================== */

        if (req.method === "GET" && pathname === "/diagnostic") {
            sendJSON(res, 200, {
                status: "ok",
                server: SERVER_VERSION,
                model: GEMINI_MODEL,
                node: process.version,
                directory: __dirname,
                indexExists: fs.existsSync(path.join(__dirname, "index.html"))
            });
            return;
        }

        /* ========================================
           API ISIDORE
        ======================================== */

        if (req.method === "POST" && pathname === "/api/solve") {

            try {
                const body = await readBody(req);

                let data;

                try {
                    data = JSON.parse(body);
                } catch {
                    sendJSON(res, 400, { error: "Requête JSON invalide." });
                    return;
                }

                const problem = String(data?.problem || "").trim();

                if (!problem) {
                    sendJSON(res, 400, { error: "Le problème est vide." });
                    return;
                }

                console.log("");
                console.log("📘 NOUVEAU PROBLÈME");
                console.log(problem);
                console.log("🧠 Modèle :", GEMINI_MODEL);

                const answer = await askGemini(problem);
                sendJSON(res, 200, { answer });

            } catch (error) {
                console.error("");
                console.error("❌ ERREUR GEMINI");
                console.error(error.message);
                console.error("");

                sendJSON(res, 500, {
                    error: error.message,
                    model: GEMINI_MODEL,
                    server: SERVER_VERSION
                });
            }

            return;
        }

        /* ========================================
           FICHIERS STATIQUES
        ======================================== */

        let requestedPath = pathname;

        if (requestedPath === "/" || requestedPath === "") {
            requestedPath = "/index.html";
        }

        requestedPath = requestedPath.replace(/^\/+/, "");

        if (requestedPath.includes("..")) {
            res.writeHead(403, {
                "Content-Type": "text/plain; charset=utf-8"
            });
            res.end("Accès interdit.");
            return;
        }

        const filePath = path.resolve(__dirname, requestedPath);
        const rootPath = path.resolve(__dirname);

        if (filePath !== rootPath && !filePath.startsWith(rootPath + path.sep)) {
            res.writeHead(403, {
                "Content-Type": "text/plain; charset=utf-8"
            });
            res.end("Accès interdit.");
            return;
        }

        console.log("");
        console.log("📂 FICHIER DEMANDÉ :", requestedPath);
        console.log("📄 CHEMIN :", filePath);

        fs.readFile(filePath, (error, data) => {
            if (error) {
                console.error("❌ Fichier introuvable :", filePath);

                res.writeHead(404, {
                    "Content-Type": "text/plain; charset=utf-8"
                });

                res.end("Fichier introuvable.");
                return;
            }

            const ext = path.extname(filePath).toLowerCase();

            res.writeHead(200, {
                "Content-Type": mimeTypes[ext] || "application/octet-stream",
                "Cache-Control": "no-cache"
            });

            res.end(data);
        });

    } catch (error) {
        console.error("❌ ERREUR SERVEUR :", error);

        if (!res.headersSent) {
            sendJSON(res, 500, {
                error: "Erreur interne du serveur."
            });
        }
    }
});


/* =====================================================
   DÉMARRAGE
===================================================== */

server.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("==============================================");
    console.log("       ISIDOREAI EST EN LIGNE");
    console.log("==============================================");
    console.log("🔥 VERSION :", SERVER_VERSION);
    console.log("🌐 PORT :", PORT);
    console.log("📂 DOSSIER :", __dirname);
    console.log("🧠 MODÈLE :", GEMINI_MODEL);
    console.log("🤖 MOTEUR : Gemini");
    console.log("==============================================");
    console.log("");
});


/* =====================================================
   ERREUR SERVEUR
===================================================== */

server.on("error", error => {
    console.error("❌ ERREUR SERVEUR :", error);
});
