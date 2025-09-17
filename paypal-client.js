require('dotenv').config();
const paypal = require('@paypal/checkout-server-sdk');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Sélectionne les identifiants et l'environnement en fonction du mode
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  throw new Error("‼️ LES IDENTIFIANTS PAYPAL (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET) SONT MANQUANTS DANS LES VARIABLES D'ENVIRONNEMENT.");
}

const environment = IS_PRODUCTION
  ? new paypal.core.LiveEnvironment(clientId, clientSecret)
  : new paypal.core.SandboxEnvironment(clientId, clientSecret);

const client = new paypal.core.PayPalHttpClient(environment);

console.log(`✅ Client PayPal initialisé en mode ${IS_PRODUCTION ? 'LIVE' : 'SANDBOX'}.`);

module.exports = { client };