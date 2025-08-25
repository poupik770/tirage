// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;
const LOTS_PATH = path.join(__dirname, 'lots.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// 🔹 Lire les lots (depuis lots.json)
app.get('/lots', (req, res) => {
  fs.readFile(LOTS_PATH, 'utf8', (err, data) => {
    if (err) {
      console.error("Erreur lecture lots:", err);
      return res.status(500).json({ error: 'Erreur de lecture des lots' });
    }
    res.json(JSON.parse(data));
  });
});

// 🔹 Enregistrer les lots (depuis l'interface admin)
app.post('/admin/save-lots', (req, res) => {
  fs.writeFile(LOTS_PATH, JSON.stringify(req.body, null, 2), (err) => {
    if (err) {
      console.error("Erreur écriture lots:", err);
      return res.status(500).json({ error: 'Erreur de sauvegarde' });
    }
    res.json({ message: 'Lots enregistrés avec succès' });
  });
});

// 🔹 Lancer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
