require('dotenv').config(); // Charge les variables depuis le fichier .env pour le développement local
const paypal = require('@paypal/checkout-server-sdk');

// 1. Déterminer l'environnement (sandbox ou live) en fonction de la variable d'environnement
const environment = process.env.PAYPAL_ENVIRONMENT === 'live'
  ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
  : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

// 2. Créer le client PayPal avec le bon environnement
const client = new paypal.core.PayPalHttpClient(environment);

// 3. Exporter directement l'instance du client
module.exports = { client };