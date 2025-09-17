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
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
    // Pour toute autre erreur, on la propage pour que l'appelant la gère
    console.error(`Erreur de lecture de la base de données ${filePath}:`, error);
    throw error;
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
  try {
    const lots = await readDatabase(DB_PATH);
    const tickets = await readDatabase(TICKETS_DB_PATH);

    const lotsAvecRestants = lots.map(lot => {
      const vendus = tickets.filter(ticket => ticket.lotId === lot.id).length;
      const ticketsRestants = lot.totalTickets ? lot.totalTickets - vendus : null;

      return {
        ...lot,
        ticketsRestants
      };
    });

    res.json({ lots: lotsAvecRestants });
  } catch (err) {
    console.error("Erreur lors du calcul des tickets restants :", err);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des lots." });
  }
});


app.post("/api/lots", async (req, res) => {
  // Sécurité : Vérifier le mot de passe admin envoyé dans les en-têtes
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Authentification administrateur requise." });
  }

  try {
    // S'assurer que le corps de la requête est bien un tableau avant de sauvegarder
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Le format des données est incorrect (doit être un tableau)." });
    }
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
  // Fournit l'ID client au frontend, en choisissant entre live et sandbox
  const paypalClientId = process.env.PAYPAL_CLIENT_ID;

  if (!paypalClientId) {
    // L'erreur principale est maintenant gérée dans paypal-client.js, mais une vérification ici reste une bonne pratique.
    console.error("‼️ L'ID client PayPal (PAYPAL_CLIENT_ID) n'est pas configuré dans les variables d'environnement.");
    return res.status(500).json({ error: "Configuration de paiement du serveur incomplète." });
  }
  res.json({ paypalClientId });
});

app.post('/api/paypal/create-order', async (req, res) => {
  const { lotId } = req.body;
  if (!lotId) return res.status(400).json({ error: "ID du lot manquant." });

  try {
    const dbData = await readDatabase(DB_PATH);
    // Rendre la lecture robuste : Gère le cas où la BDD est un objet {lots: [...]} ou un simple tableau [...]
    const lots = Array.isArray(dbData) ? dbData : dbData.lots || [];
    const lot = lots.find(l => l.id === lotId);

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

    // On considère le paiement comme réussi du point de vue de l'utilisateur.
    // On essaie d'enregistrer le ticket, mais si ça échoue, on loggue une erreur critique
    // sans faire échouer la requête pour l'utilisateur qui a déjà payé.
    res.status(200).json(captureDetails);

    try {
      const tickets = await readDatabase(TICKETS_DB_PATH);
      tickets.push(newTicket);
      await writeDatabase(TICKETS_DB_PATH, tickets);
      console.log(`✅ Ticket enregistré pour ${lotId}, payé par ${payerInfo.email_address}`);
    } catch (dbError) {
      console.error("‼️ ERREUR CRITIQUE : Le paiement PayPal a été capturé mais l'enregistrement du ticket a échoué.");
      console.error("Détails du paiement à enregistrer manuellement:", JSON.stringify(newTicket, null, 2));
      console.error("Erreur de base de données:", dbError);
    }

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
