// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { client } = require('./paypal-client'); // Importer le client PayPal
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
const DB_PATH = path.join(__dirname, "public", "lots.json");

app.use(cors());
app.use(express.json());

// 👉 Sert les fichiers du dossier "public"
app.use(express.static(path.join(__dirname, "public")));

// --- Fonctions utilitaires pour la base de données ---
function readDatabase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
      // Si le fichier est vide, retourne un tableau vide pour éviter une erreur de parsing
      return fileContent ? JSON.parse(fileContent) : [];
    }
    // Si le fichier n'existe pas, retourne un tableau vide
    return [];
  } catch (error) {
    console.error("Erreur de lecture ou de parsing de lots.json:", error);
    return []; // Retourne un tableau vide en cas d'erreur
  }
}

// --- API pour les lots ---
app.get("/api/lots", (req, res) => {
  const lots = readDatabase();
  res.json(lots);
});

app.post("/api/lots", (req, res) => {
  const data = JSON.stringify(req.body, null, 2);
  fs.writeFile(DB_PATH, data, (err) => {
    if (err) {
      console.error("Erreur en écrivant lots.json :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }
    res.json({ message: "Lots sauvegardés avec succès." });
  });
});

// --- API pour PayPal ---

// 1. Route pour créer une commande PayPal
app.post('/api/paypal/create-order', async (req, res) => {
    const { lotId } = req.body;

    if (!lotId) {
        return res.status(400).json({ error: "L'ID du lot est manquant." });
    }

    try {
        const dbData = readDatabase();
        const lot = dbData.find(l => l.id === lotId);

        if (!lot) {
            return res.status(404).json({ error: "Lot non trouvé." });
        }

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'EUR',
                    value: lot.prix.toString()
                },
                description: `Ticket pour le tirage: ${lot.nom}`,
                custom_id: lot.id
            }]
        });

        const order = await client.execute(request);
        res.status(201).json({ id: order.result.id });

    } catch (err) {
        console.error("Erreur lors de la création de la commande PayPal:", err);
        res.status(500).json({ error: "Impossible de créer la commande PayPal." });
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

        console.log('Paiement capturé avec succès pour la commande:', orderID);
        // C'est ici que vous enregistrerez le ticket dans votre base de données.

        res.status(200).json(captureDetails);

    } catch (err) {
        console.error("Erreur lors de la capture de la commande PayPal:", err);
        res.status(500).json({ error: "Impossible de finaliser le paiement." });
    }
});

// --- Démarrage du serveur ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
