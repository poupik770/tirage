// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();

app.use(cors());
app.use(express.json());

// 👉 Sert tous les fichiers du dossier "public"
app.use(express.static(path.join(__dirname, "public")));

// 👉 Exemple d’API pour récupérer lots.json
app.get("/api/lots", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "lots.json"));
});

// 👉 Exemple d’API pour sauvegarder un nouveau lots.json
const fs = require("fs");
app.post("/api/lots", (req, res) => {
  const data = JSON.stringify(req.body, null, 2);
  fs.writeFile(path.join(__dirname, "public", "lots.json"), data, (err) => {
    if (err) {
      console.error("Erreur en écrivant lots.json :", err);
      return res.status(500).json({ message: "Erreur serveur"
