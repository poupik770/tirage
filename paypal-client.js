const paypal = require('@paypal/checkout-server-sdk');

// IMPORTANT : Pour la sécurité, il est fortement recommandé de stocker ces valeurs
// dans des variables d'environnement (ex: sur Render) et non en clair dans le code.
const clientId = process.env.PAYPAL_CLIENT_ID || 'AShh7OQ-AT9vhcs6c0jWcQ-QWuuiGMi2_0XvYljd_PIT5c9ll-qyBSntgaMYOUdXvCQ-Ag63Yvuhdpbs';
const clientSecret = process.env.PAYPAL_CLIENT_SECRET || 'EI80WKng6KyqnKwJhnJhm28HUUVhJITReCAzafR8cpaKvu-0Oy5idKDyGFWHNiKYhE-mi_6ccd6CQ-Y-';

// Utilisation de l'environnement Sandbox pour les tests.
// Pour passer en production, il faudra utiliser LiveEnvironment.
const environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
const client = new paypal.core.PayPalHttpClient(environment);

module.exports = { client };