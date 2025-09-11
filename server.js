// server.js
require('dotenv').config(); // 🔐 Charge les variables d'environnement

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs").promises;
const { client } = require('./paypal-client');
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
const DB_PATH = path.join(__dirname, "public", "lots.json");
const TICKETS_DB_PATH = path.join(__dirname, "tickets.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "levy770"; // 🔐 Mot de passe sécurisé

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Fonctions utilitaires ---
async function readDatabase(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    return fileContent ? JSON.parse(fileContent) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    console.error(`Erreur lecture ${filePath}:`, error);
    return [];
  }
}

async function writeDatabase(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Erreur écriture ${filePath}:`, error);
    throw error;
  }
}

// --- API de connexion admin ---
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Mot de passe incorrect" });
  }
  res.json({ message: "Connexion réussie" });
});

// --- API lots ---
app.get("/api/lots", async (req, res) => {
  const lots = await readDatabase(DB_PATH);
  res.json(lots);
});

app.post("/api/lots", async (req, res) => {
  try {
    await writeDatabase(DB_PATH, req.body);
    res.json({ message: "Lots sauvegardés avec succès." });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur lors de la sauvegarde des lots." });
  }
});

// --- API participants protégée ---
app.post('/api/participants', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Accès non autorisé." });
  }
  const tickets = await readDatabase(TICKETS_DB_PATH);
  res.json(tickets);
});

// --- API PayPal ---
app.get('/api/config', (req, res) => {
  const paypalClientId = process.env.NODE_ENV === 'production'
    ? process.env.PAYPAL_CLIENT_ID
    : 'AShh7OQ-AT9vhcs6c0jWcQ-QWuuiGMi2_0XvYljd_PIT5c9ll-qyBSntgaMYOUdXvCQ-Ag63Yvuhdpbs';
  res.json({ paypalClientId });
});

app.post('/api/paypal/create-order', async (req, res) => {
  const { lotId } = req.body;
  if (!lotId) return res.status(400).json({ error: "ID du lot manquant." });

  try {
    const dbData = await readDatabase(DB_PATH);
    const lot = dbData.find(l => l.id === lotId);
    if (!lot) return res.status(404).json({ error: "Lot non trouvé." });

    const prix = parseFloat(lot.prix);
    if (isNaN(prix) || prix <= 0) {
      console.error(`Prix invalide pour le lot ${lotId}: '${lot.prix}'`);
      return res.status(400).json({ error: "Prix invalide." });
    }

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'EUR', value: prix.toFixed(2) },
        description: `Ticket pour le tirage: ${lot.nom}`,
        custom_id: lot.id
      }]
    });

    const order = await client.execute(request);
    res.status(201).json({ id: order.result.id });

  } catch (err) {
    console.error("Erreur création commande PayPal:", err);
    res.status(500).json({ error: "Impossible de créer la commande PayPal." });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  const { orderID } = req.body;
  if (!orderID) return res.status(400).json({ error: "ID de commande manquant." });

  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await client.execute(request);
    const captureDetails = capture.result;
    const lotId = captureDetails.purchase_units[0].custom_id;
    const payerInfo = captureDetails.payer;

    const newTicket = {
      ticketId: `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      lotId,
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

    console.log(`✅ Ticket enregistré pour ${lotId}, payé par ${payerInfo.email_address}`);
    res.status(200).json(captureDetails);

  } catch (err) {
    console.error("Erreur capture PayPal:", err);
    res.status(500).json({ error: "Impossible de finaliser le paiement." });
  }
});

// --- Démarrage serveur ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
