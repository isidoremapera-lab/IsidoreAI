import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* =====================================================
   CONFIGURATION ISIDOREAI
===================================================== */

const PORT = process.env.PORT || 10000;

// Modèle Gemini imposé pour éviter l'ancienne configuration.
const GEMINI_MODEL = "gemini-3.5-flash-lite";

// Clé API conservée uniquement sur le serveur.
const API_KEY = process.env.GEMINI_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_VERSION = "ISIDOREAI-3.5-FIX-003";

/* =====================================================
   IDENTIFICATION DU SERVEUR
===================================================== */

console.log("");
console.log("==============================================");
console.log("          ISIDOREAI - SERVEUR");
console.log("==============================================");
console.log("VERSION :", SERVER_VERSION);
console.log("MODELE  :", GEMINI_MODEL);
console.log("DOSSIER :", __dirname);
console.log("==============================================");
console.log("");

/* =====================================================
   VERIFICATION DE LA CLE API
===================================================== */

if (!API_KEY) {
    console.error("");
    console.error("ERREUR : GEMINI_API_KEY est absente.");
    console.error("Configurez cette variable dans Render.");
    console.error("");

    process.exit(1);
}

/* =====================================================
   INSTRUCTIONS DE L'ASSISTANT
===================================================== */

const SYSTEM_INSTRUCTION = `
Tu es ISIDOREAI, un assistant intelligent généraliste.

Tu réponds principalement en français, sauf si
l'utilisateur demande explicitement une autre langue.

Tu aides dans les domaines suivants :

- Mathématiques et statistiques ;
- Physique et chimie ;
- Biologie et sciences naturelles ;
- Éducation et pédagogie ;
- Informatique et programmation ;
- Mécanique et automobile ;
- Électricité et électronique ;
- Économie et gestion ;
- Histoire et géographie ;
- Littérature et langues ;
- Traduction et grammaire ;
- Technologie et culture générale.

Tu dois comprendre l'utilisateur même lorsqu'il :

- fait des fautes d'orthographe ;
- oublie les accents ;
- utilise des abréviations ;
- écrit rapidement ;
- formule imparfaitement sa question ;
- mélange plusieurs langues.

Réponds clairement, avec précision et de manière pédagogique.

Pour un problème mathématique ou scientifique :

1. Présente les données.
2. Indique ce qu'il faut rechercher.
3. Choisis la formule appropriée.
4. Effectue les calculs étape par étape.
5. Donne le résultat final avec son unité.
6. Vérifie la cohérence du résultat lorsque cela est possible.

Pour les questions générales, réponds directement.

N'invente jamais de faits, de résultats ou de références.
Si une information est incertaine, indique-le clairement.

Pour les sujets médicaux, juridiques ou sensibles,
reste prudent et recommande un professionnel lorsque
cela est nécessaire.

Ton objectif est de fournir une assistance utile,
précise, compréhensible et adaptée à l'utilisateur.
`;

/* =====================================================
   REPONSE JSON
===================================================== */

function sendJSON(res, status, data) {
    if (res.writableEnded || res.destroyed) {
        return;
    }

    if (!res.headersSent) {
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        });
    }

    res.end(JSON.stringify(data));
}

/* =====================================================
   LECTURE DU CORPS DE LA REQUETE
===================================================== */

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;
        let finished = false;

        req.on("data", chunk => {
            if (finished) return;

            size += chunk.length;

            // Limite : 100 Ko.
            if (size > 100000) {
                finished = true;
                reject(
                    new Error("Requête trop volumineuse.")
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

/* =====================================================
   APPEL A GEMINI
===================================================== */

async function askGemini(problem) {
    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    console.log("");
    console.log("==============================================");
    console.log("APPEL GEMINI");
    console.log("VERSION :", SERVER_VERSION);
    console.log("MODELE  :", GEMINI_MODEL);
    console.log("==============================================");

    const requestData = {
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
                        text:
                            `Résous le problème suivant :\n\n${problem}`
                    }
                ]
            }
        ],

        generationConfig: {
            maxOutputTokens: 3000,
            temperature: 0.3
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

            body: JSON.stringify(requestData),

            signal: AbortSignal.timeout(120000)
        });
    } catch (error) {
        console.error(
            "Erreur de connexion à Gemini :",
            error.message
        );

        throw new Error(
            "Impossible de contacter Gemini. Vérifiez la connexion du serveur."
        );
    }

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error(
            "Gemini a retourné une réponse illisible."
        );
    }

    if (!response.ok) {
        const googleMessage =
            data?.error?.message ||
            "Erreur inconnue de l'API Gemini.";

        console.error("ERREUR GEMINI :", response.status);
        console.error("DETAIL :", googleMessage);

        if (response.status === 400) {
            throw new Error(
                `Requête refusée par Gemini : ${googleMessage}`
            );
        }

        if (response.status === 401 ||
            response.status === 403) {
            throw new Error(
                "Accès refusé par Gemini. Vérifiez votre clé API et les autorisations."
            );
        }

        if (response.status === 404) {
            throw new Error(
                `Modèle Gemini introuvable ou inaccessible : ${GEMINI_MODEL}.`
            );
        }

        if (response.status === 429) {
            throw new Error(
                "Limite d'utilisation de Gemini atteinte. Réessayez plus tard."
            );
        }

        if (response.status >= 500) {
            throw new Error(
                "Le service Gemini rencontre un problème temporaire. Réessayez plus tard."
            );
        }

        throw new Error(
            `Erreur Gemini (${response.status}) : ${googleMessage}`
        );
    }

    const answer =
        data?.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

    if (!answer) {
        const finishReason =
            data?.candidates?.[0]?.finishReason;

        console.error(
            "Gemini n'a retourné aucun texte.",
            finishReason || ""
        );

        throw new Error(
            "Gemini n'a retourné aucune réponse exploitable. Veuillez reformuler votre question."
        );
    }

    console.log("Réponse Gemini reçue.");
    console.log("");

    return answer;
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
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8"
};

/* =====================================================
   SERVEUR HTTP
===================================================== */

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );

        let pathname;

        try {
            pathname = decodeURIComponent(
                requestUrl.pathname
            );
        } catch {
            sendJSON(res, 400, {
                error: "Adresse de requête invalide."
            });

            return;
        }

        /* =============================================
           HEALTH CHECK
        ============================================= */

        if (
            req.method === "GET" &&
            pathname === "/health"
        ) {
            sendJSON(res, 200, {
                status: "ok",
                service: "IsidoreAI",
                version: SERVER_VERSION,
                model: GEMINI_MODEL
            });

            return;
        }

        /* =============================================
           DIAGNOSTIC
        ============================================= */

        if (
            req.method === "GET" &&
            pathname === "/diagnostic"
        ) {
            sendJSON(res, 200, {
                status: "ok",
                service: "IsidoreAI",
                server: SERVER_VERSION,
                model: GEMINI_MODEL,
                node: process.version,
                indexExists: fs.existsSync(
                    path.join(__dirname, "index.html")
                ),
                manifestExists: fs.existsSync(
                    path.join(__dirname, "manifest.json")
                ),
                iconExists: fs.existsSync(
                    path.join(__dirname, "icon.svg")
                )
            });

            return;
        }

        /* =============================================
           API : RESOLUTION DES QUESTIONS
        ============================================= */

        if (
            pathname === "/api/solve" &&
            req.method === "POST"
        ) {
            let body;

            try {
                body = await readBody(req);
            } catch (error) {
                sendJSON(res, 413, {
                    error: error.message
                });

                return;
            }

            let data;

            try {
                data = JSON.parse(body);
            } catch {
                sendJSON(res, 400, {
                    error: "Requête JSON invalide."
                });

                return;
            }

            const problem =
                typeof data?.problem === "string"
                    ? data.problem.trim()
                    : "";

            if (!problem) {
                sendJSON(res, 400, {
                    error: "Veuillez saisir une question."
                });

                return;
            }

            if (problem.length > 20000) {
                sendJSON(res, 400, {
                    error: "Votre question est trop longue. Veuillez la raccourcir."
                });

                return;
            }

            console.log("");
            console.log("NOUVELLE QUESTION");
            console.log("Longueur :", problem.length);
            console.log("Modèle :", GEMINI_MODEL);

            try {
                const answer = await askGemini(problem);

                sendJSON(res, 200, {
                    answer: answer,
                    model: GEMINI_MODEL,
                    server: SERVER_VERSION
                });
            } catch (error) {
                console.error(
                    "ERREUR DE TRAITEMENT :",
                    error.message
                );

                sendJSON(res, 500, {
                    error: error.message,
                    model: GEMINI_MODEL,
                    server: SERVER_VERSION
                });
            }

            return;
        }

        /* =============================================
           VERIFICATION DE LA METHODE HTTP
        ============================================= */

        if (
            req.method !== "GET" &&
            req.method !== "HEAD"
        ) {
            sendJSON(res, 405, {
                error: "Méthode HTTP non autorisée."
            });

            return;
        }

        /* =============================================
           FICHIERS STATIQUES
        ============================================= */

        let requestedPath = pathname;

        if (
            requestedPath === "/" ||
            requestedPath === ""
        ) {
            requestedPath = "/index.html";
        }

        requestedPath = requestedPath.replace(/^\/+/, "");

        if (
            requestedPath.includes("..") ||
            requestedPath.includes("\\")
        ) {
            res.writeHead(403, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("Accès interdit.");
            return;
        }

        const rootPath = path.resolve(__dirname);
        const filePath = path.resolve(
            rootPath,
            requestedPath
        );

        if (
            filePath !== rootPath &&
            !filePath.startsWith(rootPath + path.sep)
        ) {
            res.writeHead(403, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("Accès interdit.");
            return;
        }

        fs.readFile(filePath, (error, fileData) => {
            if (error) {
                res.writeHead(404, {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Cache-Control": "no-store"
                });

                res.end("Fichier introuvable.");
                return;
            }

            const extension =
                path.extname(filePath).toLowerCase();

            res.writeHead(200, {
                "Content-Type":
                    mimeTypes[extension] ||
                    "application/octet-stream",

                "Cache-Control": "no-cache",

                "X-Content-Type-Options": "nosniff"
            });

            if (req.method === "HEAD") {
                res.end();
            } else {
                res.end(fileData);
            }
        });
    } catch (error) {
        console.error(
            "ERREUR SERVEUR :",
            error.message
        );

        if (!res.headersSent && !res.destroyed) {
            sendJSON(res, 500, {
                error: "Une erreur interne est survenue."
            });
        }
    }
});

/* =====================================================
   DEMARRAGE
===================================================== */

server.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("==============================================");
    console.log("       ISIDOREAI EST EN LIGNE");
    console.log("==============================================");
    console.log("VERSION :", SERVER_VERSION);
    console.log("PORT    :", PORT);
    console.log("MODELE  :", GEMINI_MODEL);
    console.log("MOTEUR  : Google Gemini API");
    console.log("==============================================");
    console.log("");
});

/* =====================================================
   ERREURS DU SERVEUR
===================================================== */

server.on("error", error => {
    console.error(
        "ERREUR SERVEUR :",
        error.message
    );
});
