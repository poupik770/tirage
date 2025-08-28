// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { client } = require('./paypal-client'); // Importer le client PayPal
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
const DB_PATH = path.join(__dirname, "public", "lots.json");
const TICKETS_DB_PATH = path.join(__dirname, "tickets.json");

app.use(cors());
app.use(express.json());

// 👉 Sert les fichiers du dossier "public"
app.use(express.static(path.join(__dirname, "public")));

// --- Fonctions utilitaires pour la base de données ---
function readDatabase(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      // Si le fichier est vide, retourne un tableau vide pour éviter une erreur de parsing
      return fileContent ? JSON.parse(fileContent) : [];
    }
    // Si le fichier n'existe pas, retourne un tableau vide
    return [];
  } catch (error) {
    console.error(`Erreur de lecture ou de parsing de ${filePath}:`, error);
    return []; // Retourne un tableau vide en cas d'erreur
  }
}

// --- API pour les lots ---
app.get("/api/lots", (req, res) => {
  const lots = readDatabase(DB_PATH);
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
        const dbData = readDatabase(DB_PATH);
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

        const tickets = readDatabase(TICKETS_DB_PATH);
        tickets.push(newTicket);
        fs.writeFileSync(TICKETS_DB_PATH, JSON.stringify(tickets, null, 2));
        console.log(`✅ Ticket enregistré pour le lot ${lotId}. Payé par ${payerInfo.email_address}.`);

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
