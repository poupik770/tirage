document.addEventListener('DOMContentLoaded', () => {

  // --- ATTENTION: SÉCURITÉ ---
  // Ce mot de passe est visible par quiconque inspecte le code de la page.
  // Pour une application réelle, la validation doit se faire côté serveur.
  const ADMIN_PASSWORD = "admin123";

  let lots = [];
  let indexEnModification = null;

  // Sélecteurs d'éléments du DOM
  const loginSection = document.getElementById('loginSection');
  const adminPanel = document.getElementById('adminPanel');
  const loginBtn = document.getElementById('loginBtn');
  const adminPassInput = document.getElementById('adminPass');
  const loginError = document.getElementById('loginError');
  
  const lotForm = document.getElementById('lotForm');
  const lotNomInput = document.getElementById('lotNom');
  const lotImageInput = document.getElementById('lotImage');
  const lotPrixInput = document.getElementById('lotPrix');
  const submitBtn = document.getElementById('submitBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const formTitle = document.getElementById('formTitle');

  const listeLotsDiv = document.getElementById('listeLots');
  const saveBtn = document.getElementById('saveBtn');
  const sauvegardeStatus = document.getElementById('sauvegardeStatus');

  // --- Fonctions ---

  function login() {
    if (adminPassInput.value === ADMIN_PASSWORD) {
      loginSection.style.display = 'none';
      adminPanel.style.display = 'block';
      chargerLots();
    } else {
      loginError.style.display = 'block';
    }
  }

  async function chargerLots() {
    try {
      const response = await fetch('/lots');
      if (!response.ok) throw new Error('Erreur réseau');
      lots = await response.json();
      afficherLots();
    } catch (err) {
      console.error("Erreur de chargement des lots:", err);
      listeLotsDiv.innerHTML = "<p class='error-message'>Impossible de charger les lots.</p>";
    }
  }

  function afficherLots() {
    listeLotsDiv.innerHTML = "";
    if (lots.length === 0) {
        listeLotsDiv.innerHTML = "<p>Aucun lot pour le moment.</p>";
        return;
    }

    lots.forEach((lot, index) => {
      const lotElement = document.createElement("div");
      lotElement.className = "lot-item";
      lotElement.innerHTML = `
        <img src="${lot.image}" alt="${lot.nom}">
        <div class="lot-details">
          <strong>${lot.nom}</strong>
          <p>🎟️ ${lot.prix}</p>
        </div>
        <div class="lot-actions">
          <button class="btn btn-warning" data-index="${index}">✏️ Modifier</button>
          <button class="btn btn-danger" data-index="${index}">🗑️ Supprimer</button>
        </div>
      `;
      listeLotsDiv.appendChild(lotElement);
    });
  }

  function gererClicListe(event) {
    const target = event.target;
    const index = target.dataset.index;

    if (target.classList.contains('btn-warning')) {
      demarrerModification(index);
    } else if (target.classList.contains('btn-danger')) {
      supprimerLot(index);
    }
  }
  
  function ajouterOuModifierLot(event) {
    event.preventDefault(); // Empêche le rechargement de la page

    const nom = lotNomInput.value;
    const image = lotImageInput.value;
    const prix = lotPrixInput.value;

    if (!nom || !image || !prix) return; // Validation simple

    const nouveauLot = { nom, image, prix };

    if (indexEnModification !== null) {
      lots[indexEnModification] = nouveauLot;
    } else {
      lots.push(nouveauLot);
    }

    afficherLots();
    reinitialiserFormulaire();
  }

  function demarrerModification(index) {
    const lot = lots[index];
    lotNomInput.value = lot.nom;
    lotImageInput.value = lot.image;
    lotPrixInput.value = lot.prix;
    
    indexEnModification = index;

    formTitle.textContent = "Modifier le lot";
    submitBtn.textContent = "💾 Mettre à jour";
    cancelBtn.style.display = "inline-block";
    window.scrollTo(0, 0); // Remonte en haut de la page pour voir le formulaire
  }
  
  function supprimerLot(index) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le lot "${lots[index].nom}" ?`)) {
      lots.splice(index, 1);
      afficherLots();
    }
  }

  function reinitialiserFormulaire() {
    lotForm.reset();
    indexEnModification = null;
    formTitle.textContent = "Ajouter un nouveau lot";
    submitBtn.innerHTML = "➕ Ajouter le lot";
    cancelBtn.style.display = "none";
  }

  async function sauvegarderLots() {
    sauvegardeStatus.textContent = 'Sauvegarde en cours...';
    sauvegardeStatus.className = 'status-message';
    try {
      const response = await fetch('/admin/save-lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lots)
      });
      if (!response.ok) throw new Error('Réponse serveur non valide');
      const result = await response.json();
      sauvegardeStatus.textContent = `✅ ${result.message}`;
      sauvegardeStatus.classList.add('success');
    } catch (err) {
      sauvegardeStatus.textContent = '❌ Erreur lors de la sauvegarde.';
      sauvegardeStatus.classList.add('error');
      console.error("Erreur de sauvegarde:", err);
    }
  }

  // --- Écouteurs d'événements ---
  loginBtn.addEventListener('click', login);
  adminPassInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
  });
  
  lotForm.addEventListener('submit', ajouterOuModifierLot);
  cancelBtn.addEventListener('click', reinitialiserFormulaire);
  saveBtn.addEventListener('click', sauvegarderLots);
  listeLotsDiv.addEventListener('click', gererClicListe);

});