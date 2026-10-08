import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PORT = Number(process.env.PORT || 8090);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const API_KEY = process.env.GEMINI_API_KEY;
const LOG_DIR = process.env.LOG_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "logs");
const LOG_FILE = process.env.LOG_FILE || path.join(LOG_DIR, "isidore.log");
const LOG_MAX_SIZE = Number(process.env.LOG_MAX_SIZE || 5 * 1024 * 1024);
const LOG_MAX_FILES = Number(process.env.LOG_MAX_FILES || 5);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =====================================================
   VÉRIFICATION DE LA CLÉ
===================================================== */

if (!API_KEY) {
    console.error("");
    console.error("❌ Clé Gemini absente.");
    console.error("");
    console.error("Configurez-la avec :");
    console.error('export GEMINI_API_KEY="VOTRE_CLE"');
    console.error("");
    process.exit(1);
}

/* =====================================================
   LOGS FICHIER + ROTATION
===================================================== */

function ensureLogDir() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateLogFile() {
    if (!fs.existsSync(LOG_FILE)) return;

    const stat = fs.statSync(LOG_FILE);
    if (stat.size < LOG_MAX_SIZE) return;

    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
        const source = `${LOG_FILE}.${i}`;
        const target = `${LOG_FILE}.${i + 1}`;

        if (fs.existsSync(source)) {
            if (i === LOG_MAX_FILES - 1 && fs.existsSync(target)) {
                fs.unlinkSync(target);
            }
            fs.renameSync(source, target);
        }
    }

    if (fs.existsSync(`${LOG_FILE}.1`)) {
        fs.unlinkSync(`${LOG_FILE}.1`);
    }

    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
}

function writeLogLine(entry) {
    ensureLogDir();

    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size >= LOG_MAX_SIZE) {
        rotateLogFile();
    }

    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
}

function logger(level, msg, meta = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        msg
    };

    if (Object.keys(meta).length > 0) {
        entry.meta = meta;
    }

    writeLogLine(entry);
    console.log(JSON.stringify(entry));
}

/* =====================================================
   INSTRUCTIONS D'ISIDORE
===================================================== */

const SYSTEM_INSTRUCTION = `

Tu es ISIDOREAI, un assistant intelligent généraliste.

Tu réponds principalement en français, sauf si
l'utilisateur demande explicitement une autre langue.

Tu peux répondre à des questions dans de nombreux domaines :

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

Tu dois essayer de comprendre l'utilisateur même lorsqu'il :

- fait des fautes d'orthographe ;
- oublie des accents ;
- écrit rapidement ;
- utilise des abréviations ;
- écrit phonétiquement ;
- mélange plusieurs langues ;
- formule mal sa question.

Réponds de manière claire, structurée et pédagogique.

Lorsque la question nécessite un raisonnement,
explique les étapes plutôt que de donner uniquement
la réponse finale.

Pour les problèmes de mathématiques et de sciences :
- identifie les données ;
- identifie ce qui est recherché ;
- donne la formule utile ;
- effectue le calcul étape par étape ;
- donne le résultat avec son unité lorsque c'est nécessaire.

Pour les questions générales, réponds directement
et ne prétends pas qu'une question est hors domaine
simplement parce qu'elle ne concerne pas la mécanique.

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
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify(data));
}

/* =====================================================
   ÉCHAPPEMENT HTML
===================================================== */

function escapeHTML(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* =====================================================
   APPEL GEMINI
===================================================== */

async function askGemini(problem) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const body = {
        system_instruction: {
            parts: [
                {
                    text: SYSTEM_INSTRUCTION
                }
            ]
        },
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `Résous le problème suivant :\n\n${problem}`
                    }
                ]
            }
        ],
        generationConfig: {
            maxOutputTokens: 3000
        }
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
        },
        body: JSON.stringify(body)
    });

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("Réponse invalide reçue de Gemini.");
    }

    if (!response.ok) {
        const message = data?.error?.message || "Erreur inconnue de Gemini.";
        throw new Error(message);
    }

    const text = data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!text) {
        throw new Error("Gemini n'a retourné aucune réponse.");
    }

    return text;
}

/* =====================================================
   LECTURE DU CORPS DE LA REQUÊTE
===================================================== */

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        const onData = chunk => {
            body += typeof chunk === "string" ? chunk : chunk.toString("utf8");

            if (body.length > 100000) {
                req.destroy();
                reject(new Error("Requête trop volumineuse."));
            }
        };

        const onEnd = () => {
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("error", onError);
            resolve(body);
        };

        const onError = error => {
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("error", onError);
            reject(error);
        };

        req.on("data", onData);
        req.on("end", onEnd);
        req.on("error", onError);
    });
}

/* =====================================================
   SERVEUR
===================================================== */

const server = http.createServer(async (req, res) => {
    logger("info", "Requête reçue", {
        method: req.method,
        url: req.url,
        ip: req.socket.remoteAddress
    });

    /* ================================================
       API ISIDORE
    ================================================= */

    if (req.method === "POST" && req.url === "/api/solve") {
        try {
            const body = await readBody(req);

            let data;

            try {
                data = JSON.parse(body);
            } catch {
                logger("warn", "JSON invalide", { url: req.url });
                sendJSON(res, 400, { error: "Requête JSON invalide." });
                return;
            }

            const problem = String(data?.problem || "").trim();

            if (!problem) {
                logger("warn", "Problème vide", { url: req.url });
                sendJSON(res, 400, { error: "Le problème est vide." });
                return;
            }

            logger("info", "Nouveau problème", { length: problem.length });

            const answer = await askGemini(problem);

            logger("info", "Réponse Gemini reçue", { length: answer.length });

            sendJSON(res, 200, { answer });
        } catch (error) {
            logger("error", "Erreur Gemini", {
                message: error.message,
                stack: error.stack
            });

            sendJSON(res, 500, {
                error: error.message || "Erreur interne du serveur."
            });
        }

        return;
    }

    /* ================================================
       PAGE PRINCIPALE
    ================================================= */

    const url = new URL(req.url || "/", "http://localhost");
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const publicRoot = path.resolve(__dirname);
    const resolvedPath = path.resolve(publicRoot, "." + requestedPath);
    const rootPrefix = `${publicRoot}${path.sep}`;

    if (resolvedPath !== publicRoot && !resolvedPath.startsWith(rootPrefix)) {
        logger("warn", "Tentative d’accès interdit", {
            requestedPath,
            ip: req.socket.remoteAddress
        });
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Accès interdit.");
        return;
    }

    fs.readFile(resolvedPath, (error, data) => {
        if (error) {
            logger("warn", "Fichier introuvable", {
                requestedPath,
                ip: req.socket.remoteAddress
            });
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("Fichier introuvable.");
            return;
        }

        const ext = path.extname(resolvedPath);

        const mimeTypes = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml"
        };

        res.writeHead(200, {
            "Content-Type": mimeTypes[ext] || "application/octet-stream"
        });

        res.end(data);
    });
});

/* =====================================================
   DÉMARRAGE
===================================================== */

server.listen(PORT, "0.0.0.0", () => {
    logger("info", "Démarrage du serveur", {
        port: PORT,
        model: GEMINI_MODEL,
        logFile: LOG_FILE,
        logMaxSize: LOG_MAX_SIZE,
        logMaxFiles: LOG_MAX_FILES
    });

    console.log("");
    console.log("======================================");
    console.log("       ISIDORE V5.1 + GEMINI");
    console.log("======================================");
    console.log(`🌐 http://127.0.0.1:${PORT}`);
    console.log(`🧠 Modèle : ${GEMINI_MODEL}`);
    console.log("🤖 Moteur IA : Gemini");
    console.log("======================================");
    console.log("");
});

/* =====================================================
   ERREUR SERVEUR
===================================================== */

server.on("error", error => {
    logger("error", "Erreur serveur", {
        code: error.code,
        message: error.message
    });

    if (error.code === "EADDRINUSE") {
        console.error("");
        console.error(`❌ Le port ${PORT} est déjà utilisé.`);
        console.error("Arrêtez l'ancien serveur avec CTRL+C.");
        console.error("");
    } else {
        console.error("❌ Erreur serveur :", error);
    }
});

process.on("SIGINT", () => {
    logger("info", "Arrêt du serveur", { signal: "SIGINT" });
    server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
    logger("info", "Arrêt du serveur", { signal: "SIGTERM" });
    server.close(() => process.exit(0));
});
