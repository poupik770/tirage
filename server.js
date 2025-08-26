const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// GET /lots
app.get("/lots", (req, res) => {
  const filePath = path.join(__dirname, "public", "lots.json");
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Impossible de lire lots.json" });
    res.json(JSON.parse(data));
  });
});

// POST /save-lots
app.post("/save-lots", (req, res) => {
  const filePath = path.join(__dirname, "public", "lots.json");
  fs.writeFile(filePath, JSON.stringify(req.body, null, 2), (err) => {
    if (err) return res.status(500).json({ error: "Erreur lors de la sauvegarde" });
    res.json({ message: "Lots sauvegardés avec succès ✅" });
  });
});

app.listen(PORT, () => console.log("Serveur lancé sur http://localhost:" + PORT));
