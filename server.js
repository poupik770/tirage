require('dotenv').config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs").promises;
const { client } = require('./paypal-client');
const paypal = require('@paypal/checkout-server-sdk');
const nodemailer = require('nodemailer');

const app = express();
const DB_PATH = path.join(__dirname, "public", "lots.json");
const TICKETS_DB_PATH = path.join(__dirname, "tickets.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "levy770";
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Configuration du transporteur d'email (Nodemailer) ---
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587', 10),
  secure: (process.env.EMAIL_PORT === '465'), // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Vérification de la connexion SMTP au démarrage du serveur
transporter.verify(function(error, success) {
  if (error || !process.env.EMAIL_USER) {
    console.error("⚠️  Service d'email non configuré ou erreur. Les emails ne seront pas envoyés.", error ? error.message : "EMAIL_USER non défini.");
  } else {
    console.log("✅ Service d'email prêt à envoyer des confirmations.");
  }
});

// --- Fonctions utilitaires ---
async function readDatabase(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    return fileContent ? JSON.parse(fileContent) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
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

// --- API lots avec tickets restants ---
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

// --- API pour sauvegarder les lots ---
app.post("/api/lots", async (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Authentification administrateur requise." });
  }

  try {
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

// --- API PayPal : config frontend ---
app.get('/api/config', (req, res) => {
  const paypalClientId = process.env.PAYPAL_CLIENT_ID;

  if (!paypalClientId) {
    console.error("‼️ PAYPAL_CLIENT_ID manquant dans les variables d'environnement.");
    return res.status(500).json({ error: "Configuration de paiement du serveur incomplète." });
  }
  res.json({ paypalClientId });
});

// --- API PayPal : création de commande ---
app.post('/api/paypal/create-order', async (req, res) => {
  const { lotId, quantity } = req.body;
  if (!lotId || !quantity) {
    return res.status(400).json({ error: "ID du lot ou quantité manquante." });
  }

  const numQuantity = parseInt(quantity, 10);
  if (isNaN(numQuantity) || numQuantity <= 0) {
    return res.status(400).json({ error: "La quantité doit être un nombre positif." });
  }

  try {
    const lots = await readDatabase(DB_PATH);
    const tickets = await readDatabase(TICKETS_DB_PATH);
    const lot = lots.find(l => l.id === lotId);

    if (!lot) {
      return res.status(404).json({ error: "Lot non trouvé." });
    }

    const vendus = tickets.filter(t => t.lotId === lot.id).length;
    const ticketsRestants = lot.totalTickets - vendus;
    if (lot.totalTickets && numQuantity > ticketsRestants) {
      return res.status(400).json({ error: `Quantité insuffisante. Il ne reste que ${ticketsRestants} ticket(s).` });
    }

    const prix = parseFloat(lot.prix);
    if (isNaN(prix) || prix <= 0) {
      console.error(`Prix invalide pour le lot ${lotId}: '${lot.prix}'`);
      return res.status(400).json({ error: "Prix invalide." });
    }

    const totalValue = (prix * numQuantity).toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'EUR', value: totalValue },
        description: `${numQuantity} x Ticket(s) pour le tirage: ${lot.nom}`,
        custom_id: lot.id // Gardé pour référence, pourrait contenir lotId et quantity
      }]
    });

    const order = await client.execute(request);
    res.status(201).json({ id: order.result.id });

  } catch (err) {
    console.error("Erreur création commande PayPal:", err);
    res.status(500).json({ error: "Impossible de créer la commande PayPal." });
  }
});

// --- API PayPal : capture du paiement ---
app.post('/api/paypal/capture-order', async (req, res) => {
  const { orderID, lotId, quantity } = req.body;
  if (!orderID || !lotId || !quantity) {
    return res.status(400).json({ error: "Données de commande incomplètes (orderID, lotId, quantity)." });
  }

  const numQuantity = parseInt(quantity, 10);
  if (isNaN(numQuantity) || numQuantity <= 0) {
    return res.status(400).json({ error: "Quantité invalide." });
  }

  console.log("📦 Données reçues pour capture :", { orderID, lotId, quantity: numQuantity });

  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await client.execute(request);
    const details = capture.result;

    if (!details || !details.payer || !details.purchase_units || !details.purchase_units[0]) {
      console.error("⚠️ Réponse PayPal incomplète :", JSON.stringify(details, null, 2));
      return res.status(500).json({ error: "Réponse inattendue de PayPal. Paiement non capturé." });
    }

    if (details.status === 'COMPLETED') {
      // On récupère les infos du lot pour l'email
      const lots = await readDatabase(DB_PATH);
      const lot = lots.find(l => l.id === lotId);
      try {
        const tickets = await readDatabase(TICKETS_DB_PATH);
        const payerInfo = {
          name: `${details.payer.name.given_name} ${details.payer.name.surname}`,
          email: details.payer.email_address
        };

        // Boucle pour créer le nombre de tickets achetés
        for (let i = 0; i < numQuantity; i++) {
          const nouveauTicket = {
            ticketId: `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${i}`,
            lotId,
            orderId: orderID,
            purchaseDate: new Date().toISOString(),
            payer: payerInfo
          };
          tickets.push(nouveauTicket);
        }

        await writeDatabase(TICKETS_DB_PATH, tickets);
        console.log(`✅ ${numQuantity} ticket(s) enregistré(s) pour ${lotId}, payé par ${payerInfo.email}`);

        // --- Envoi de l'email de confirmation ---
        if (lot && process.env.EMAIL_USER) {
          try {
            const mailOptions = {
              from: `"Tirage Exclusif" <${process.env.EMAIL_USER}>`,
              to: payerInfo.email,
              subject: `Confirmation de votre participation au tirage "${lot.nom}"`,
              html: `
                <h1>Merci pour votre participation !</h1>
                <p>Bonjour ${payerInfo.name},</p>
                <p>Nous vous confirmons votre achat de <strong>${numQuantity} ticket(s)</strong> pour le tirage du lot suivant :</p>
                <h2>${lot.nom}</h2>
                <p><strong>Montant total :</strong> ${details.purchase_units[0].amount.value} €</p>
                <p><strong>Numéro de transaction :</strong> ${orderID}</p>
                <p>Le tirage au sort aura lieu le ${new Date(lot.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', 'year': 'numeric' })}. Nous vous souhaitons bonne chance !</p>
                <br>
                <p>L'équipe de Tirage Exclusif</p>
              `
            };
            await transporter.sendMail(mailOptions);
            console.log(`📧 Email de confirmation envoyé à ${payerInfo.email}`);
          } catch (emailError) {
            console.error(`‼️ ERREUR lors de l'envoi de l'email de confirmation à ${payerInfo.email}:`, emailError);
          }
        }
      } catch (dbError) {
        console.error("‼️ ERREUR CRITIQUE : Paiement capturé mais enregistrement du ticket échoué.");
        console.error(`Détails de la transaction : orderID=${orderID}, lotId=${lotId}, quantity=${numQuantity}`);
        console.error(`Infos acheteur : ${JSON.stringify(details.payer, null, 2)}`);
        console.error("Erreur :", dbError);
      }
    }

    res.status(200).json(details);

  } catch (error) {
    console.error("Erreur lors de la capture de la commande :", JSON.stringify(error, null, 2)); // Gardons l'ancien log pour le moment
    res.status(500).json({ error: "La validation du paiement a échoué. Veuillez vérifier les logs du serveur." });
  }
});

// --- Démarrage serveur ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
