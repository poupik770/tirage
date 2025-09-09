// c:\tirage-sort\debug-paypal-order.js

// Importez le client PayPal et le SDK
const { client } = require('./paypal-client');
const paypal = require('@paypal/checkout-server-sdk');

/**
 * Fonction pour créer une commande PayPal avec une gestion d'erreurs détaillée.
 */
async function createOrderForDebug() {
  // 1. Construire l'objet de la requête
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'EUR', // VÉRIFIEZ : Est-ce la bonne devise ?
        value: '10.00'        // VÉRIFIEZ : Le montant doit être une chaîne de caractères !
      },
      description: 'Participation au tirage au sort'
    }]
  });

  // 2. Exécuter la requête dans un bloc try...catch
  try {
    console.log("Tentative de création de la commande PayPal...");
    const order = await client.execute(request);
    
    console.log("✅ Commande créée avec succès !");
    console.log("ID de la commande :", order.result.id);
    console.log("Réponse complète :", JSON.stringify(order.result, null, 2));
    
    return order.result.id;

  } catch (err) {
    // 3. C'est ici que nous capturons et affichons l'erreur détaillée
    console.error("❌ Échec de la création de la commande PayPal.");
    console.error("===================================================");
    
    console.error(`Code de statut HTTP : ${err.statusCode}`);
    
    // Le message d'erreur de PayPal est souvent un JSON. Essayons de le parser.
    try {
      const errorDetails = JSON.parse(err.message);
      console.error("Détails de l'erreur PayPal :", JSON.stringify(errorDetails, null, 2));
    } catch (e) {
      // Si ce n'est pas du JSON, on affiche le message brut
      console.error("Message d'erreur brut :", err.message);
    }
    
    console.error("===================================================");
    return null;
  }
}

// Pour exécuter ce script de débogage :
// Ouvrez votre terminal et tapez : node c:\tirage-sort\debug-paypal-order.js
createOrderForDebug();