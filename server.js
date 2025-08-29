// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs").promises; // Utiliser la version promise de fs pour les opérations asynchrones
const { client } = require('./paypal-client'); // Importer le client PayPal
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
const DB_PATH = path.join(__dirname, "public", "lots.json");
const TICKETS_DB_PATH = path.join(__dirname, "tickets.json");
const ADMIN_PASSWORD = "levy770"; // Mot de passe admin

app.use(cors());
app.use(express.json());

// 👉 Sert les fichiers du dossier "public"
app.use(express.static(path.join(__dirname, "public")));

// --- Fonctions utilitaires pour la base de données (asynchrones) ---
async function readDatabase(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    // Si le fichier est vide, retourne un tableau vide pour éviter une erreur de parsing
    return fileContent ? JSON.parse(fileContent) : [];
  } catch (error) {
    // Si le fichier n'existe pas (ENOENT), c'est normal, on retourne un tableau vide.
    if (error.code === 'ENOENT') {
      return [];
    }
    // Pour les autres erreurs (parsing, permissions, etc.), on logue et on retourne un tableau vide.
    console.error(`Erreur de lecture ou de parsing de ${filePath}:`, error);
    return []; // Retourne un tableau vide en cas d'erreur
  }
}

async function writeDatabase(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Erreur en écrivant dans ${filePath}:`, error);
    throw error; // Propage l'erreur pour que l'appelant puisse la gérer (ex: envoyer une réponse 500)
  }
}

// --- API pour les lots ---
app.get("/api/lots", async (req, res) => {
  const lots = await readDatabase(DB_PATH);
  res.json(lots);
});

// --- API pour la configuration ---
app.get('/api/config', (req, res) => {
  // Fournit l'ID client PayPal au frontend, en utilisant la clé LIVE en production
  const paypalClientId = process.env.NODE_ENV === 'production'
    ? process.env.PAYPAL_CLIENT_ID
    : 'AShh7OQ-AT9vhcs6c0jWcQ-QWuuiGMi2_0XvYljd_PIT5c9ll-qyBSntgaMYOUdXvCQ-Ag63Yvuhdpbs'; // ID Sandbox pour le test

  res.json({ paypalClientId });
});

app.post("/api/lots", async (req, res) => {
  try {
    await writeDatabase(DB_PATH, req.body);
    res.json({ message: "Lots sauvegardés avec succès." });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur lors de la sauvegarde des lots." });
  }
});

// --- API pour les participants (protégée par mot de passe) ---
app.post('/api/participants', async (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Accès non autorisé." });
  }

  const tickets = await readDatabase(TICKETS_DB_PATH);
  res.json(tickets);
});

// --- API pour PayPal ---

// 1. Route pour créer une commande PayPal
app.post('/api/paypal/create-order', async (req, res) => {
    const { lotId } = req.body;

    if (!lotId) {
        return res.status(400).json({ error: "L'ID du lot est manquant." });
    }

    try {
        const dbData = await readDatabase(DB_PATH);
        const lot = dbData.find(l => l.id === lotId);

        if (!lot) {
            return res.status(404).json({ error: "Lot non trouvé." });
        }

        const prix = parseFloat(lot.prix);
        if (isNaN(prix) || prix <= 0) {
            console.error(`Prix invalide pour le lot ${lotId}: '${lot.prix}'. Le paiement ne peut pas être créé.`);
            return res.status(400).json({ error: "Le prix configuré pour ce lot est invalide." });
        }

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'EUR',
                    // Utiliser le prix validé et formaté à 2 décimales
                    value: prix.toFixed(2)
                },
                description: `Ticket pour le tirage: ${lot.nom}`,
                custom_id: lot.id
            }]
        });

        const order = await client.execute(request);
        res.status(201).json({ id: order.result.id });

    } catch (err) {
        const errorMessage = "Impossible de créer la commande PayPal.";
        console.error(`[PayPal Create Order Error] ${errorMessage}`, err);
        // L'erreur du SDK PayPal (HttpError) contient des informations utiles pour le débogage
        if (err.statusCode) {
            console.error(`[PayPal Error Details] Status: ${err.statusCode}, Message: ${err.message}`);
            if (err.result) {
                console.error(JSON.stringify(err.result, null, 2));
            }
        }
        res.status(500).json({ error: errorMessage });
    }
});

// 2. Route pour capturer (finaliser) le paiement
app.post('/api/paypal/capture-order', async (req, res) => {
    const { orderID } = req.body;

    if (!orderID) {
        return res.status(400).json({ error: "L'ID de la commande est manquant." });
    }

    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    try {
        const capture = await client.execute(request);
        const captureDetails = capture.result;

        // Paiement réussi, maintenant on enregistre le ticket.
        const lotId = captureDetails.purchase_units[0].custom_id;
        const payerInfo = captureDetails.payer;

        if (!lotId) {
            // Ne devrait jamais arriver si la création de commande fonctionne bien
            console.error("CRITICAL: ID de lot non trouvé dans la capture PayPal pour la commande:", orderID);
        }

        const newTicket = {
            ticketId: `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            lotId: lotId,
            orderId: orderID,
            purchaseDate: new Date().toISOString(),
            payer: {
                email: payerInfo.email_address,
                name: `${payerInfo.name.given_name} ${payerInfo.name.surname}`
            }
        };

        const tickets = await readDatabase(TICKETS_DB_PATH);
        tickets.push(newTicket);
        await writeDatabase(TICKETS_DB_PATH, tickets);

        console.log(`✅ Ticket enregistré pour le lot ${lotId}. Payé par ${payerInfo.email_address}.`);

        res.status(200).json(captureDetails);

    } catch (err) {
        const errorMessage = "Impossible de finaliser le paiement.";
        console.error(`[PayPal Capture Order Error] ${errorMessage}`, err);
        if (err.statusCode) {
            console.error(`[PayPal Error Details] Status: ${err.statusCode}, Message: ${err.message}`);
            if (err.result) {
                console.error(JSON.stringify(err.result, null, 2));
            }
        }
        res.status(500).json({ error: errorMessage });
    }
});

// --- Démarrage du serveur ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
