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

app.post('/api/paypal/capture-order', async (req, res) => {
  const { orderID, lotId } = req.body;
  if (!orderID || !lotId) {
    return res.status(400).json({ error: "ID de commande ou ID du lot manquant." });
  }

    const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await client.execute(request);
    const details = capture.result;

    // Vérification de la réponse PayPal
    if (!details || !details.payer || !details.purchase_units || !details.purchase_units[0]) {
      console.error("⚠️ Réponse PayPal incomplète :", JSON.stringify(details, null, 2));
      return res.status(500).json({ error: "Réponse inattendue de PayPal. Paiement non capturé." });
    }

    // Enregistrement du ticket si le paiement est complété
    if (details.status === 'COMPLETED') {
      const nouveauTicket = {
        ticketId: `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        lotId,
        orderId: orderID,
        purchaseDate: new Date().toISOString(),
        payer: {
          name: `${details.payer.name.given_name} ${details.payer.name.surname}`,
          email: details.payer.email_address
        }
      };

      try {
        const tickets = await readDatabase(TICKETS_DB_PATH);
        tickets.push(nouveauTicket);
        await writeDatabase(TICKETS_DB_PATH, tickets);
        console.log(`✅ Ticket enregistré pour ${lotId}, payé par ${details.payer.email_address}`);
      } catch (dbError) {
        console.error("‼️ ERREUR CRITIQUE : Paiement capturé mais enregistrement du ticket échoué.");
        console.error("Ticket à enregistrer manuellement :", JSON.stringify(nouveauTicket, null, 2));
        console.error("Erreur :", dbError);
      }
    }

    // Réponse au frontend
    res.status(200).json(details);

  } catch (err) {
    console.error("❌ Erreur lors de la capture de la commande PayPal.");
    console.error("===================================================");
    console.error(`ID de la commande qui a échoué : ${orderID}`);
    
    // Les erreurs de l'API PayPal sont souvent des objets HttpError avec des détails utiles
    if (err.statusCode) {
      console.error(`Code de statut HTTP : ${err.statusCode}`);
      // Le message d'erreur est souvent une chaîne JSON, essayons de la parser.
      try {
        const errorDetails = JSON.parse(err.message);
        console.error("Détails de l'erreur PayPal :", JSON.stringify(errorDetails, null, 2));
      } catch (e) {
        // Si ce n'est pas du JSON, on affiche le message brut
        console.error("Message d'erreur brut :", err.message);
      }
    } else {
      // Pour les erreurs non-HTTP (ex: problème réseau, erreur de programmation)
      console.error("Erreur non-HTTP ou inattendue :", err);
    }
    console.error("===================================================");
    res.status(500).json({ error: "La validation du paiement a échoué. Veuillez vérifier les logs du serveur." });
  }
});

;

// --- Démarrage serveur ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
