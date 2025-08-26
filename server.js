// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const Stripe = require("stripe");
const app = express();

const stripe = Stripe("sk_test_TON_SECRET_KEY"); // <-- remplace par ta clé Stripe

app.use(cors());
app.use(express.json());

// Servir fichiers statiques
app.use(express.static(path.join(__dirname, "public")));

// GET lots.json
app.get("/api/lots", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "lots.json"));
});

// POST pour sauvegarder lots.json
app.post("/api/lots", (req, res) => {
  fs.writeFile(path.join(__dirname, "public", "lots.json"), JSON.stringify(req.body, null, 2), (err) => {
    if (err) return res.status(500).json({ message: "Erreur serveur" });
    res.json({ message: "Lots sauvegardés avec succès ✅" });
  });
});

// Créer une session Stripe
app.post("/create-checkout-session", async (req, res) => {
  const { email, lot } = req.body;
  if(!email || !lot) return res.status(400).json({ error: "Données manquantes" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: { name: lot.nom },
          unit_amount: lot.prix * 100,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/cancel.html`,
    });
    res.json({ url: session.url });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Erreur Stripe" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));
