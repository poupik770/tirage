const { client } = require('./paypal-client');
const paypal = require('@paypal/checkout-server-sdk');

(async () => {
  try {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'EUR', value: '1.00' },
        description: 'Test de paiement PayPal',
        custom_id: 'test_lot_001'
      }]
    });

    const response = await client.execute(request);
    console.log("✅ Commande PayPal créée avec succès !");
    console.log("🆔 ID de commande :", response.result.id);
  } catch (err) {
    console.error("❌ Échec de la création de commande PayPal");
    console.error("Code d’erreur :", err.statusCode);
    console.error("Message :", err.message);
    if (err.result) {
      console.error("Détails :", JSON.stringify(err.result, null, 2));
    }
  }
})();
