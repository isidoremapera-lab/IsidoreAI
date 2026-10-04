import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PORT = process.env.PORT || 8090;

// Modèle Gemini
const GEMINI_MODEL = "gemini-3.5-flash-lite";

// La clé reste uniquement côté serveur
const API_KEY = process.env.GEMINI_API_KEY;

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
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =====================================================
   APPEL GEMINI
===================================================== */

async function askGemini(problem) {

    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
                        text:
                        `Résous le problème suivant :\n\n${problem}`
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


    const data = await response.json();


    if (!response.ok) {

        const message =
            data?.error?.message ||
            "Erreur inconnue de Gemini.";

        throw new Error(message);
    }


    const text =
        data?.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();


    if (!text) {

        throw new Error(
            "Gemini n'a retourné aucune réponse."
        );
    }


    return text;
}


/* =====================================================
   LECTURE DU CORPS DE LA REQUÊTE
===================================================== */

function readBody(req) {

    return new Promise((resolve, reject) => {

        let body = "";

        req.on("data", chunk => {

            body += chunk;

            // Protection contre les requêtes énormes
            if (body.length > 100000) {

                reject(
                    new Error(
                        "Requête trop volumineuse."
                    )
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
   SERVEUR
===================================================== */

const server = http.createServer(
async (req, res) => {


    /* ================================================
       API ISIDORE
    ================================================= */

    if (
        req.method === "POST" &&
        req.url === "/api/solve"
    ) {

        try {

            const body =
                await readBody(req);


            let data;

            try {

                data =
                    JSON.parse(body);

            } catch {

                sendJSON(
                    res,
                    400,
                    {
                        error:
                        "Requête JSON invalide."
                    }
                );

                return;
            }


            const problem =
                String(
                    data?.problem || ""
                ).trim();


            if (!problem) {

                sendJSON(
                    res,
                    400,
                    {
                        error:
                        "Le problème est vide."
                    }
                );

                return;
            }


            console.log(
                "\n📘 Nouveau problème :"
            );

            console.log(problem);


            const answer =
                await askGemini(problem);


            console.log(
                "✅ Réponse Gemini reçue."
            );


            sendJSON(
                res,
                200,
                {
                    answer: answer
                }
            );


        } catch (error) {

            console.error(
                "\n❌ Erreur Gemini :"
            );

            console.error(
                error.message
            );


            sendJSON(
                res,
                500,
                {
                    error:
                    error.message
                }
            );
        }


        return;
    }


    /* ================================================
       PAGE PRINCIPALE
    ================================================= */

    let requestedPath =
        req.url === "/"
        ? "/index.html"
        : req.url;


    // Empêcher ../
    requestedPath =
        decodeURIComponent(requestedPath)
        .replace(/\.\./g, "");


    const filePath =
    path.join(
        __dirname,
        "." + requestedPath
    );

    fs.readFile(
        filePath,
        (error, data) => {


            if (error) {

                res.writeHead(
                    404,
                    {
                        "Content-Type":
                        "text/plain; charset=utf-8"
                    }
                );

                res.end(
                    "Fichier introuvable."
                );

                return;
            }


            const ext =
                path.extname(filePath);


            const mimeTypes = {

                ".html":
                    "text/html; charset=utf-8",

                ".js":
                    "text/javascript; charset=utf-8",

                ".css":
                    "text/css; charset=utf-8",

                ".json":
                    "application/json; charset=utf-8",

                ".png":
                    "image/png",

                ".jpg":
                    "image/jpeg",

                ".jpeg":
                    "image/jpeg",

                ".svg":
                    "image/svg+xml"

            };


            res.writeHead(
                200,
                {
                    "Content-Type":
                        mimeTypes[ext] ||
                        "application/octet-stream"
                }
            );


            res.end(data);

        }
    );

});


/* =====================================================
   DÉMARRAGE
===================================================== */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "======================================"
        );

        console.log(
            "       ISIDORE V5.1 + GEMINI"
        );

        console.log(
            "======================================"
        );

        console.log(
            `🌐 http://127.0.0.1:${PORT}`
        );

        console.log(
            `🧠 Modèle : ${GEMINI_MODEL}`
        );

        console.log(
            "🤖 Moteur IA : Gemini"
        );

        console.log(
            "======================================"
        );

        console.log("");

    }
);


/* =====================================================
   ERREUR SERVEUR
===================================================== */

server.on(
    "error",
    error => {

        if (error.code === "EADDRINUSE") {

            console.error("");
            console.error(
                `❌ Le port ${PORT} est déjà utilisé.`
            );

            console.error(
                "Arrêtez l'ancien serveur avec CTRL+C."
            );

            console.error("");

        } else {

            console.error(
                "❌ Erreur serveur :",
                error
            );
        }

    }
);
