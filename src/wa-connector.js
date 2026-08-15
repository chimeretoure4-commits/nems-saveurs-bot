const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

// ============ AUTHENTIFICATION ADMIN ============
const ADMIN_PASSWORD = 'nems2026';
const sessions = new Map();
function verifierSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/session=([^;]+)/);
  return match && sessions.has(match[1]);
}
function genererSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// ============ FRAIS DE LIVRAISON ============
const FRAIS_FILE = path.resolve(__dirname, '..', 'frais.json');
function chargerFrais() {
  try { if (fs.existsSync(FRAIS_FILE)) return JSON.parse(fs.readFileSync(FRAIS_FILE, 'utf8')); } catch (e) {}
  return { montant: 1000 };
}
function sauvegarderFrais(frais) {
  try { fs.writeFileSync(FRAIS_FILE, JSON.stringify(frais, null, 2)); } catch (e) {}
}

// ============ STOCKS ============
const STOCKS_FILE = path.resolve(__dirname, '..', 'stocks.json');
function chargerStocks() {
  try { if (fs.existsSync(STOCKS_FILE)) return JSON.parse(fs.readFileSync(STOCKS_FILE, 'utf8')); } catch (e) {}
  return { 'nems_non_cuits': 100, 'nems_cuits': 100, 'beignets_crevettes_non_cuits': 100, 'beignets_crevettes_cuits': 100 };
}
function sauvegarderStocks(stocks) {
  try { fs.writeFileSync(STOCKS_FILE, JSON.stringify(stocks, null, 2)); } catch (e) {}
}

const CATALOG = {
  'nems_non_cuits': { nom: 'Nems non cuits', emoji: '🥟', prix: { 5: 1250, 10: 2500, 15: 3750, 20: 5000, 25: 6250, 30: 7500, 40: 10000, 45: 11250, 50: 12500 } },
  'nems_cuits': { nom: 'Nems cuits', emoji: '🍽️', prix: { 5: 1500, 10: 3000, 15: 4500, 20: 6000, 25: 7500, 30: 9000, 35: 10500, 40: 12000, 45: 13500, 50: 15000 } },
  'beignets_crevettes_non_cuits': { nom: 'Beignets crevettes non cuits', emoji: '🍤', prix: { 5: 1750, 10: 3500, 15: 5250, 20: 7000, 25: 8750, 30: 10500, 35: 12250, 40: 14000, 45: 15750, 50: 17500 } },
  'beignets_crevettes_cuits': { nom: 'Beignets crevettes cuits', emoji: '🍤', prix: { 5: 1750, 10: 3500, 15: 5250, 20: 7000, 25: 8750, 30: 10500, 35: 12250, 40: 14000, 45: 15750, 50: 17500 } }
};

const PROMOTIONS = [
  { code: 'NEMS10', reduction: 10, description: '-10% sur toute la commande' },
  { code: 'BIENVENUE', reduction: 5, description: '-5% pour les nouveaux clients' }
];

const LIVREURS = [
  { id: 'LIV1', nom: 'Abdallah', telephone: '221774893329', zone: 'Dakar', actif: true },
  { id: 'LIV2', nom: 'Assishow', telephone: '221779789713', zone: 'Dakar', actif: true }
];

let compteurLivreur = 0;
function assignerLivreur(adresse) {
  const actifs = LIVREURS.filter(l => l.actif);
  if (actifs.length === 0) return null;
  compteurLivreur++;
  return actifs[compteurLivreur % actifs.length];
}

const CLIENTS_FILE = path.resolve(__dirname, '..', 'clients.json');
function chargerClients() {
  try { if (fs.existsSync(CLIENTS_FILE)) return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8')); } catch (e) {}
  return {};
}
function sauvegarderClients(clients) {
  try { fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2)); } catch (e) {}
}
function enregistrerClient(userId) {
  const clients = chargerClients();
  if (!clients[userId]) clients[userId] = { userId, nombreCommandes: 0, totalDepense: 0, datePremiereCommande: new Date().toISOString() };
  clients[userId].nombreCommandes++;
  return clients;
}

const paniers = new Map();
const userStates = new Map();
const panierTimers = new Map();
const ETATS = { ACCUEIL: 'accueil', PANIER: 'panier', LIVRAISON: 'livraison', ADRESSE: 'adresse' };

let compteurCommandes = 0;

function genererNumeroCommande(typeRecuperation) {
  compteurCommandes++;
  const maintenant = new Date();
  const jour = String(maintenant.getDate()).padStart(2, '0');
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const annee = maintenant.getFullYear();
  const suffixe = typeRecuperation === 'livraison' ? 'L' : 'R';
  const numero = String(compteurCommandes).padStart(3, '0');
  return `CMD-${jour}${mois}${annee}-${numero}-${suffixe}`;
}

function getPanier(userId) { if (!paniers.has(userId)) paniers.set(userId, []); return paniers.get(userId); }
function getEtat(userId) { return userStates.get(userId) || ETATS.ACCUEIL; }
function setEtat(userId, etat) { userStates.set(userId, etat); }
function getPrix(k, q) { const p = CATALOG[k]; return p ? (p.prix[q] || null) : null; }
function getQuantitesValides(produitKey) { const p = CATALOG[produitKey]; return p ? Object.keys(p.prix).map(Number) : []; }

function ajouterAuPanier(userId, k, q) {
  const prix = getPrix(k, q);
  if (!prix) return { success: false, message: `❌ Quantité ${q} non disponible pour ${CATALOG[k].nom}.\nQuantités valides : ${getQuantitesValides(k).join(', ')}` };
  const panier = getPanier(userId);
  const found = panier.find(i => i.produitKey === k);
  if (found) found.quantite += q;
  else panier.push({ produitKey: k, quantite: q });
  return { success: true };
}

function afficherPanier(userId) {
  const panier = getPanier(userId);
  if (panier.length === 0) return 'Votre panier est vide 🛒';
  let total = 0;
  let m = '🛒 *VOTRE PANIER*\n━━━━━━━━━━━━━━━━━\n\n';
  panier.forEach((item, i) => {
    const p = CATALOG[item.produitKey];
    const prix = getPrix(item.produitKey, item.quantite);
    total += prix;
    m += `${i + 1}. ${p.emoji} ${p.nom}\n   ${item.quantite} pieces x ${prix.toLocaleString('fr-FR').replace(/\u202f/g, ' ')} FCFA\n\n`;
  });
  m += `━━━━━━━━━━━━━━━━━\n💰 *TOTAL : ${total.toLocaleString('fr-FR').replace(/\u202f/g, ' ')} FCFA*`;
  return m;
}

function afficherCatalogue() {
  const stocks = chargerStocks();
  let m = '📋 *NEMS SAVEURS - MENU OFFICIEL*\n';
  m += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  m += '🥟 *NEMS NON CUITS*\n• 5 pcs ..... 1 250 FCFA\n• 10 pcs .... 2 500 FCFA\n• 15 pcs .... 3 750 FCFA\n• 20 pcs .... 5 000 FCFA\n• 25 pcs .... 6 250 FCFA\n• 30 pcs .... 7 500 FCFA\n• 40 pcs .... 10 000 FCFA\n• 45 pcs .... 11 250 FCFA\n• 50 pcs .... 12 500 FCFA\n\n';
  m += '🍽️ *NEMS CUITS*\n• 5 pcs ..... 1 500 FCFA\n• 10 pcs .... 3 000 FCFA\n• 15 pcs .... 4 500 FCFA\n• 20 pcs .... 6 000 FCFA\n• 25 pcs .... 7 500 FCFA\n• 30 pcs .... 9 000 FCFA\n• 35 pcs .... 10 500 FCFA\n• 40 pcs .... 12 000 FCFA\n• 45 pcs .... 13 500 FCFA\n• 50 pcs .... 15 000 FCFA\n\n';
  m += '🍤 *BEIGNETS CREVETTES*\n(Cuits ou non cuits - même prix)\n• 5 pcs ..... 1 750 FCFA\n• 10 pcs .... 3 500 FCFA\n• 15 pcs .... 5 250 FCFA\n• 20 pcs .... 7 000 FCFA\n• 25 pcs .... 8 750 FCFA\n• 30 pcs .... 10 500 FCFA\n• 35 pcs .... 12 250 FCFA\n• 40 pcs .... 14 000 FCFA\n• 45 pcs .... 15 750 FCFA\n• 50 pcs .... 17 500 FCFA\n\n';
  m += '━━━━━━━━━━━━━━━━━━━━━\n💡 *COMMENT COMMANDER ?*\n« 20 nems cuits »\n« 10 crevettes non cuites »\n\n';
  m += '🎁 *PROMOTIONS :*\n';
  PROMOTIONS.forEach(p => { m += `• *${p.code}* : ${p.description}\n`; });
  m += '\n📞 Besoin d\'aide ? Tapez *equipe*';
  return m;
}

function parserCommande(texte) {
  const result = [];
  const t = texte.toLowerCase();
  const nemsRegex = /(\d+)\s*(nems?|nem)\s*(cuits?|non\s*cuits?|pas\s*cuits?)?/gi;
  let m;
  while ((m = nemsRegex.exec(t)) !== null) {
    const q = parseInt(m[1]);
    const type = m[3] || '';
    let k;
    if (type.includes('non') || type.includes('pas')) k = 'nems_non_cuits';
    else if (type.includes('cuit')) k = 'nems_cuits';
    else k = 'nems_non_cuits';
    result.push({ produitKey: k, quantite: q });
  }
  const bevRegex = /(\d+)\s*(beignets?\s*crevettes?|crevettes?)\s*(cuits?|non\s*cuits?|pas\s*cuits?)?/gi;
  while ((m = bevRegex.exec(t)) !== null) {
    const q = parseInt(m[1]);
    const type = m[3] || '';
    let k;
    if (type.includes('non') || type.includes('pas')) k = 'beignets_crevettes_non_cuits';
    else if (type.includes('cuit')) k = 'beignets_crevettes_cuits';
    else k = 'beignets_crevettes_non_cuits';
    result.push({ produitKey: k, quantite: q });
  }
  return result;
}

const COMMANDES_FILE = path.resolve(__dirname, '..', 'commandes.json');
function sauvegarderCommande(cmd) {
  try {
    let cmds = [];
    if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
    cmds.push(cmd);
    fs.writeFileSync(COMMANDES_FILE, JSON.stringify(cmds, null, 2));
    console.log('💾 Sauvegardé:', cmd.numeroCommande);
  } catch (e) { console.error('Erreur save:', e.message); }
}

let sockGlobal = null;
let promoEnCours = new Map();

function demarrerRelancePanier(userId) {
  if (panierTimers.has(userId)) clearTimeout(panierTimers.get(userId));
  const timer = setTimeout(async () => {
    const panier = getPanier(userId);
    if (panier.length > 0 && getEtat(userId) === ETATS.PANIER) {
      if (sockGlobal) {
        try {
          await sockGlobal.sendMessage(userId, { text: '🛒 *VOTRE PANIER VOUS ATTEND !*\n━━━━━━━━━━━━━━━━━\n\nVous avez des articles dans votre panier.\n\n' + afficherPanier(userId) + '\n\n📌 *OPTIONS*\n1️⃣ Confirmer\n2️⃣ Ajouter\n3️⃣ Vider' });
        } catch (e) {}
      }
    }
    panierTimers.delete(userId);
  }, 5 * 60 * 1000);
  panierTimers.set(userId, timer);
}

function demarrerSuiviCommande(userId, numeroCommande) {
  setTimeout(async () => {
    if (sockGlobal) {
      try {
        await sockGlobal.sendMessage(userId, { text: '📋 *SUIVI DE VOTRE COMMANDE*\n━━━━━━━━━━━━━━━━━\n\n🔖 N° : *' + numeroCommande + '*\n\n✅ Votre commande a bien été reçue.\nNotre équipe la prépare avec soin 🥟❤️\n\n📞 Besoin d\'aide ? Tapez *equipe*' });
      } catch (e) {}
    }
  }, 2 * 60 * 1000);
}

async function traiterMessage(userId, texte) {
  const t = texte.toLowerCase().trim();
  const etat = getEtat(userId);

  if (t.includes('equipe') || t.includes('parler') || t.includes('assistante')) {
    setEtat(userId, ETATS.ACCUEIL);
    return '📞 *ASSISTANCE*\n━━━━━━━━━━━━━━━━━\n\nJe vous mets en relation avec notre équipe 👩‍💼\nQuelqu\'un va vous répondre très rapidement.\n\nMerci de votre patience ❤️';
  }

  const promoMatch = PROMOTIONS.find(p => t.includes(p.code.toLowerCase()));
  if (promoMatch) {
    promoEnCours.set(userId, promoMatch);
    setEtat(userId, ETATS.ACCUEIL);
    return `🎁 *PROMOTION ACTIVÉE !*\n━━━━━━━━━━━━━━━━━\n\n✅ Code *${promoMatch.code}* appliqué : ${promoMatch.description}\n\nContinuez votre commande !\n\n💡 Tapez "menu" pour voir le catalogue.`;
  }

  switch(etat) {
    case ETATS.LIVRAISON:
      if (t.includes('livraison') || texte === '1') {
        setEtat(userId, ETATS.ADRESSE);
        return '🚚 *LIVRAISON*\n━━━━━━━━━━━━━━━━━\n\nParfait ! 👍\n\nMerci de nous envoyer votre *adresse complète* de livraison 📍';
      }
      if (t.includes('retrait') || t.includes('recuperer') || texte === '2') {
        const produits = getPanier(userId).map(item => {
          const p = CATALOG[item.produitKey];
          return { nom: p.nom, emoji: p.emoji, quantite: item.quantite, prix: getPrix(item.produitKey, item.quantite) };
        });
        let sousTotal = produits.reduce((s, p) => s + p.prix, 0);
        const promo = promoEnCours.get(userId);
        if (promo) sousTotal = sousTotal - (sousTotal * promo.reduction / 100);
        
        // Décrémenter les stocks
        const stocks = chargerStocks();
        produits.forEach(p => {
          const key = Object.keys(CATALOG).find(k => CATALOG[k].nom === p.nom);
          if (key) stocks[key] = Math.max(0, (stocks[key] || 100) - p.quantite);
        });
        sauvegarderStocks(stocks);
        
        const cmd = { numeroCommande: genererNumeroCommande('retrait'), clientWhatsApp: userId, produits, sousTotal: Math.round(sousTotal), typeRecuperation: 'retrait', adresse: '', statut: 'en_attente', date: new Date().toISOString(), promo: promo ? promo.code : null, livreur: null };
        sauvegarderCommande(cmd);
        const clients = enregistrerClient(userId);
        clients[userId].totalDepense += Math.round(sousTotal);
        sauvegarderClients(clients);
        promoEnCours.delete(userId);
        paniers.delete(userId);
        if (panierTimers.has(userId)) { clearTimeout(panierTimers.get(userId)); panierTimers.delete(userId); }
        setEtat(userId, ETATS.ACCUEIL);
        
        if (sockGlobal) {
          try {
            await sockGlobal.sendMessage('221776886486@s.whatsapp.net', { text: `🔔 *NOUVELLE COMMANDE (RETRAIT)*\n\n📋 ${cmd.numeroCommande}\n👤 ${userId}\n\n${produits.map((p, i) => `${i + 1}. ${p.emoji} ${p.nom} × ${p.quantite} = ${p.prix} FCFA`).join('\n')}\n\n💰 Total : ${Math.round(sousTotal)} FCFA${promo ? `\n🎁 Promo : ${promo.code}` : ''}\n📍 Retrait : HLM FASS` });
          } catch (e) {}
        }
        
        demarrerSuiviCommande(userId, cmd.numeroCommande);
        return `✅ *COMMANDE CONFIRMÉE !*\n━━━━━━━━━━━━━━━━━\n\n🔖 N° : *${cmd.numeroCommande}*\n\n📍 Point de retrait : *HLM FASS*\n\nNous vous confirmerons quand votre commande sera prête ❤️`;
      }
      return '📌 *MODE DE RÉCUPÉRATION*\n━━━━━━━━━━━━━━━━━\n\n1️⃣ 🚚 Livraison\n2️⃣ 📍 Retrait (HLM FASS)';

    case ETATS.ADRESSE:
      const produits = getPanier(userId).map(item => {
        const p = CATALOG[item.produitKey];
        return { nom: p.nom, emoji: p.emoji, quantite: item.quantite, prix: getPrix(item.produitKey, item.quantite) };
      });
      let sousTotal = produits.reduce((s, p) => s + p.prix, 0);
      const promo = promoEnCours.get(userId);
      if (promo) sousTotal = sousTotal - (sousTotal * promo.reduction / 100);
      
      // Décrémenter les stocks
      const stocks = chargerStocks();
      produits.forEach(p => {
        const key = Object.keys(CATALOG).find(k => CATALOG[k].nom === p.nom);
        if (key) stocks[key] = Math.max(0, (stocks[key] || 100) - p.quantite);
      });
      sauvegarderStocks(stocks);
      
      const livreur = assignerLivreur(texte);
      const frais = chargerFrais();
      
      const cmd = { numeroCommande: genererNumeroCommande('livraison'), clientWhatsApp: userId, produits, sousTotal: Math.round(sousTotal), typeRecuperation: 'livraison', adresse: texte, statut: 'en_attente', date: new Date().toISOString(), promo: promo ? promo.code : null, livreur: livreur ? livreur.nom : null, livreurTel: livreur ? livreur.telephone : null, fraisLivraison: frais.montant };
      sauvegarderCommande(cmd);
      const clients = enregistrerClient(userId);
      clients[userId].totalDepense += Math.round(sousTotal);
      sauvegarderClients(clients);
      promoEnCours.delete(userId);
      paniers.delete(userId);
      if (panierTimers.has(userId)) { clearTimeout(panierTimers.get(userId)); panierTimers.delete(userId); }
      setEtat(userId, ETATS.ACCUEIL);
      
      if (sockGlobal) {
        try {
          await sockGlobal.sendMessage('221776886486@s.whatsapp.net', { text: `🔔 *NOUVELLE COMMANDE (LIVRAISON)*\n\n📋 ${cmd.numeroCommande}\n👤 ${userId}\n\n${produits.map((p, i) => `${i + 1}. ${p.emoji} ${p.nom} × ${p.quantite} = ${p.prix} FCFA`).join('\n')}\n\n💰 Total : ${Math.round(sousTotal)} FCFA\n🚚 Livraison : ${frais.montant} FCFA\n💰 Total Final : ${Math.round(sousTotal) + frais.montant} FCFA${promo ? `\n🎁 Promo : ${promo.code}` : ''}\n📍 Adresse : ${texte}\n🚚 Livreur : ${livreur ? livreur.nom : 'Non assigné'}` });
        } catch (e) {}
      }
      
      if (livreur && sockGlobal) {
        try {
          await sockGlobal.sendMessage(livreur.telephone + '@s.whatsapp.net', { 
            text: `🚚 *NOUVELLE LIVRAISON ASSIGNÉE*\n━━━━━━━━━━━━━━━━━\n\n📋 Commande : *${cmd.numeroCommande}*\n👤 Client : ${userId}\n\n🛒 Produits :\n${produits.map((p, i) => `${i + 1}. ${p.emoji} ${p.nom} × ${p.quantite}`).join('\n')}\n\n💰 Total : ${Math.round(sousTotal)} FCFA\n🚚 Livraison : ${frais.montant} FCFA\n📍 Adresse : ${texte}\n\n📌 Répondez *OK* pour confirmer la prise en charge`
          });
          console.log(`🚚 Livreur ${livreur.nom} notifié`);
        } catch (e) {}
      }
      
      demarrerSuiviCommande(userId, cmd.numeroCommande);
      
      return `✅ *COMMANDE ENREGISTRÉE !*\n━━━━━━━━━━━━━━━━━\n\n🔖 N° : *${cmd.numeroCommande}*\n\n📍 Livraison : ${texte}\n${livreur ? `🚚 Livreur : *${livreur.nom}*` : ''}\n🚚 Frais : *${frais.montant} FCFA*\n\nNotre assistante vous contactera pour confirmer 👩‍💼`;

    case ETATS.PANIER:
      if (t.includes('confirmer') || t.includes('valider') || t === 'oui' || texte === '1') {
        if (panierTimers.has(userId)) { clearTimeout(panierTimers.get(userId)); panierTimers.delete(userId); }
        setEtat(userId, ETATS.LIVRAISON);
        return afficherPanier(userId) + '\n\n📌 *MODE DE RÉCUPÉRATION*\n1️⃣ 🚚 Livraison\n2️⃣ 📍 Retrait';
      }
      if (t.includes('annuler') || t.includes('vider')) {
        paniers.delete(userId);
        if (panierTimers.has(userId)) { clearTimeout(panierTimers.get(userId)); panierTimers.delete(userId); }
        setEtat(userId, ETATS.ACCUEIL);
        return '🗑️ Panier vidé.\n\nTapez *menu* pour voir le catalogue.';
      }
      {
        const cmds = parserCommande(texte);
        if (cmds.length > 0) {
          let rep = '✅ *AJOUTÉ AU PANIER*\n━━━━━━━━━━━━━━━━━\n\n';
          cmds.forEach(c => {
            const resultat = ajouterAuPanier(userId, c.produitKey, c.quantite);
            if (resultat.success) {
              const p = CATALOG[c.produitKey];
              rep += `${p.emoji} ${p.nom} × ${c.quantite}\n`;
            } else {
              rep += resultat.message + '\n';
            }
          });
          rep += '\n' + afficherPanier(userId) + '\n\n📌 *OPTIONS*\n1️⃣ Confirmer\n2️⃣ Ajouter autre produit\n3️⃣ Vider le panier';
          demarrerRelancePanier(userId);
          return rep;
        }
      }
      return '❓ Confirmer, ajouter ou vider le panier ?';

    default:
      if (t.includes('bonjour') || t.includes('salut') || t.includes('bonsoir')) {
        const accueilMsg = '👋 *BIENVENUE CHER(E) CLIENT(E)*\n' +
          '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
          '🥟 *NEMS SAVEURS*\n' +
          'Votre goût authentique du nems\n' +
          '100% asiatique\n\n' +
          '📦 *VENTE EN LIGNE*\n' +
          '🚚 *LIVRAISON PARTOUT*\n\n' +
          '📍 *DAKAR - HLM FASS*\n' +
          '📞 *TÉL : +221 77 688 64 86*\n\n' +
          '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
          '📌 *VEUILLEZ CHOISIR UNE OPTION :*\n\n' +
          '1️⃣ 📋 Consulter le Menu\n' +
          '2️⃣ 🛒 Passer une Commande\n' +
          '3️⃣ 📞 Parler à notre Équipe\n\n' +
          '💡 *Répondez simplement par 1, 2 ou 3*';
        await sockGlobal.sendMessage(userId, { text: accueilMsg });
        return null;
      }
      if (t.includes('menu') || t.includes('catalogue')) {
        const imagesDir = path.resolve(__dirname, '..', 'data');
        const photosMenu = ['menu1.jpg.jpeg', 'menu2.jpg.jpeg'];
        for (const photo of photosMenu) {
          const photoPath = path.join(imagesDir, photo);
          if (fs.existsSync(photoPath)) {
            try { await sockGlobal.sendMessage(userId, { image: fs.readFileSync(photoPath), caption: '📋 *NEMS SAVEURS - MENU*' }); } catch (e) {}
          }
        }
        return afficherCatalogue();
      }
      if (t.includes('commande') || t.includes('commander')) {
        setEtat(userId, ETATS.PANIER);
        return '🛒 *PASSER UNE COMMANDE*\n━━━━━━━━━━━━━━━━━\n\n' + afficherCatalogue();
      }
      {
        const cmds = parserCommande(texte);
        if (cmds.length > 0) {
          setEtat(userId, ETATS.PANIER);
          let rep = '✅ *COMMANDE REÇUE*\n━━━━━━━━━━━━━━━━━\n\n';
          cmds.forEach(c => {
            const resultat = ajouterAuPanier(userId, c.produitKey, c.quantite);
            if (resultat.success) {
              const p = CATALOG[c.produitKey];
              rep += `${p.emoji} ${p.nom} × ${c.quantite}\n`;
            } else {
              rep += resultat.message + '\n';
            }
          });
          rep += '\n' + afficherPanier(userId) + '\n\n📌 *OPTIONS*\n1️⃣ Confirmer\n2️⃣ Ajouter\n3️⃣ Vider';
          demarrerRelancePanier(userId);
          return rep;
        }
      }
      return '❓ *Je n\'ai pas compris*\n━━━━━━━━━━━━━━━━━\n\n1️⃣ 📋 *Menu* → Tapez "menu"\n2️⃣ 🛒 *Commander* → Ex : "20 nems cuits"\n3️⃣ 📞 *Assistance* → Tapez "equipe"\n\nJe reste à votre disposition 😊';
  }
}

// ============ DASHBOARD ============
function nettoyerNumero(jid) {
  let numero = jid;
  if (numero.endsWith('@lid')) numero = numero.replace('@lid', '@s.whatsapp.net');
  const chiffres = numero.replace(/[^0-9]/g, '');
  if (chiffres.length >= 9) return `+${chiffres.slice(0, 3)} ${chiffres.slice(3, 5)} ${chiffres.slice(5, 8)} ${chiffres.slice(8, 10)} ${chiffres.slice(10)}`;
  return jid;
}

const http = require('http');
function demarrerServeurWeb() {
  const server = http.createServer((req, res) => {
    // ============ PAGE DE CONNEXION ============
    if (req.url === '/login' || req.url === '/login?erreur=1') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const password = params.get('password');
          if (password === ADMIN_PASSWORD) {
            const sessionId = genererSessionId();
            sessions.set(sessionId, true);
            res.writeHead(302, { 'Location': '/', 'Set-Cookie': `session=${sessionId}; HttpOnly; Path=/` });
            res.end();
          } else {
            res.writeHead(302, { 'Location': '/login?erreur=1' });
            res.end();
          }
        });
        return;
      }
      let html = '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Connexion Admin</title>';
      html += '<style>*{box-sizing:border-box}body{font-family:sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.login-box{background:white;border-radius:15px;padding:30px;box-shadow:0 5px 20px rgba(0,0,0,0.1);width:100%;max-width:400px}.login-box h1{margin:0 0 10px;font-size:24px;color:#e63946;text-align:center}.login-box p{margin:0 0 20px;font-size:14px;color:#666;text-align:center}.login-box input{width:100%;padding:15px;border:1px solid #ddd;border-radius:8px;font-size:16px;margin-bottom:15px}.login-box button{width:100%;padding:15px;background:#e63946;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer}.erreur{background:#ffebee;color:#c62828;padding:10px;border-radius:5px;margin-bottom:15px;font-size:14px;text-align:center}</style>';
      html += '</head><body><div class="login-box"><h1>🔐 Admin Nems Saveurs</h1><p>Entrez votre mot de passe</p>';
      if (req.url.includes('erreur=1')) html += '<div class="erreur">❌ Mot de passe incorrect !</div>';
      html += '<form method="POST" action="/login"><input type="password" name="password" placeholder="Mot de passe" required><button type="submit">Se connecter</button></form></div></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // ============ VÉRIFIER SESSION POUR TOUTES LES AUTRES ROUTES ============
    if (!verifierSession(req) && req.url !== '/login') {
      res.writeHead(302, { 'Location': '/login' });
      res.end();
      return;
    }

    if (req.url.startsWith('/changer-statut')) {
      const url = new URL(req.url, 'http://localhost');
      const cmd = url.searchParams.get('cmd');
      const statut = url.searchParams.get('statut');
      if (cmd && statut) {
        let cmds = [];
        if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
        const idx = cmds.findIndex(c => c.numeroCommande === cmd);
        if (idx !== -1) { cmds[idx].statut = statut; fs.writeFileSync(COMMANDES_FILE, JSON.stringify(cmds, null, 2)); }
      }
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }
    if (req.url.startsWith('/supprimer')) {
      const url = new URL(req.url, 'http://localhost');
      const cmd = url.searchParams.get('cmd');
      if (cmd) {
        let cmds = [];
        if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
        cmds = cmds.filter(c => c.numeroCommande !== cmd);
        fs.writeFileSync(COMMANDES_FILE, JSON.stringify(cmds, null, 2));
      }
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }
    if (req.url === '/nettoyer-tout') {
      fs.writeFileSync(COMMANDES_FILE, JSON.stringify([], null, 2));
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }
    if (req.url === '/export-csv') {
      let cmds = [];
      if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
      let csv = 'Numero;Date;Client;Type;Produits;Total;Adresse;Statut;Promo;Livreur;FraisLivraison\n';
      cmds.forEach(cmd => {
        const produitsStr = cmd.produits.map(p => `${p.nom} x${p.quantite}`).join(' | ');
        const client = nettoyerNumero(cmd.clientWhatsApp).replace(/;/g, '');
        csv += `${cmd.numeroCommande};${new Date(cmd.date).toLocaleString('fr-FR')};${client};${cmd.typeRecuperation};"${produitsStr}";${cmd.sousTotal};"${cmd.adresse}";${cmd.statut};${cmd.promo || ''};${cmd.livreur || ''};${cmd.fraisLivraison || ''}\n`;
      });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=commandes.csv' });
      res.end(csv);
      return;
    }
    if (req.url === '/commandes') {
      let cmds = [];
      if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(cmds, null, 2));
      return;
    }
    if (req.url === '/clients') {
      const clients = chargerClients();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(clients, null, 2));
      return;
    }
    if (req.url === '/livreurs') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(LIVREURS, null, 2));
      return;
    }
    if (req.url === '/stocks') {
      const stocks = chargerStocks();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(stocks, null, 2));
      return;
    }
    if (req.url === '/frais') {
      const frais = chargerFrais();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(frais, null, 2));
      return;
    }
    if (req.url.startsWith('/modifier-frais')) {
      const url = new URL(req.url, 'http://localhost');
      const montant = parseInt(url.searchParams.get('montant'));
      if (montant && montant > 0) {
        sauvegarderFrais({ montant });
      }
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }
    if (req.url.startsWith('/modifier-stock')) {
      const url = new URL(req.url, 'http://localhost');
      const produit = url.searchParams.get('produit');
      const quantite = parseInt(url.searchParams.get('quantite'));
      if (produit && quantite >= 0) {
        const stocks = chargerStocks();
        stocks[produit] = quantite;
        sauvegarderStocks(stocks);
      }
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }
    if (req.url === '/' || req.url.startsWith('/?filtre=')) {
      const url = new URL(req.url, 'http://localhost');
      const filtre = url.searchParams.get('filtre') || 'toutes';
      const recherche = url.searchParams.get('recherche') || '';
      let cmds = [];
      if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
      if (filtre === 'livraison') cmds = cmds.filter(c => c.typeRecuperation === 'livraison');
      if (filtre === 'retrait') cmds = cmds.filter(c => c.typeRecuperation === 'retrait');
      if (filtre === 'en_attente') cmds = cmds.filter(c => c.statut === 'en_attente');
      if (filtre === 'prete') cmds = cmds.filter(c => c.statut === 'prete');
      if (filtre === 'livree') cmds = cmds.filter(c => c.statut === 'livree');
      if (recherche) cmds = cmds.filter(c => c.numeroCommande.toLowerCase().includes(recherche.toLowerCase()) || c.clientWhatsApp.toLowerCase().includes(recherche.toLowerCase()) || c.adresse.toLowerCase().includes(recherche.toLowerCase()));
      
      const totalCommandes = cmds.length;
      const totalRevenus = cmds.reduce((s, c) => s + c.sousTotal, 0);
      const livraisons = cmds.filter(c => c.typeRecuperation === 'livraison').length;
      const retraits = cmds.filter(c => c.typeRecuperation === 'retrait').length;
      const enAttente = cmds.filter(c => c.statut === 'en_attente').length;
      const clients = chargerClients();
      const totalClients = Object.keys(clients).length;
      const frais = chargerFrais();
      const stocks = chargerStocks();
      
      let html = '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Nems Saveurs - Dashboard</title>';
      html += '<style>*{box-sizing:border-box}body{font-family:sans-serif;padding:15px;background:#f5f5f5;margin:0}.header{background:#e63946;color:white;padding:20px;border-radius:10px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}.header h1{margin:0;font-size:20px}.header-btns{display:flex;gap:8px;flex-wrap:wrap}.btn{background:white;color:#e63946;padding:10px 15px;border-radius:5px;text-decoration:none;font-weight:bold;font-size:14px}.search{margin-bottom:15px}.search input{width:100%;padding:12px;border-radius:8px;border:1px solid #ddd;font-size:16px}.stats{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}.stat-card{background:white;border-radius:10px;padding:15px;flex:1;min-width:130px;box-shadow:0 2px 5px rgba(0,0,0,0.1);text-align:center}.stat-card h3{margin:0;font-size:13px;color:#666}.stat-card p{margin:5px 0 0;font-size:22px;font-weight:bold;color:#e63946}.filtres{margin-bottom:20px;display:flex;gap:8px;flex-wrap:wrap}.filtre{background:white;padding:8px 15px;border-radius:20px;text-decoration:none;color:#333;font-size:13px;box-shadow:0 2px 5px rgba(0,0,0,0.1)}.filtre.active{background:#e63946;color:white}.c{background:white;border-radius:10px;padding:15px;margin:10px 0;box-shadow:0 2px 5px rgba(0,0,0,0.1)}.c-header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:10px;flex-wrap:wrap;gap:10px}.c-header h2{margin:0;font-size:15px}.badges{display:flex;gap:5px;flex-wrap:wrap}.statut-livraison{background:#e76f51;color:white;padding:5px 10px;border-radius:15px;font-size:11px;font-weight:bold}.statut-retrait{background:#264653;color:white;padding:5px 10px;border-radius:15px;font-size:11px;font-weight:bold}.statut-en_attente{background:#f4a261;color:white;padding:5px 10px;border-radius:15px;font-size:11px;font-weight:bold}.statut-prete{background:#2a9d8f;color:white;padding:5px 10px;border-radius:15px;font-size:11px;font-weight:bold}.statut-livree{background:#6c757d;color:white;padding:5px 10px;border-radius:15px;font-size:11px;font-weight:bold}.c-body p{margin:5px 0;font-size:14px}.produits{margin:10px 0;padding:10px;background:#f9f9f9;border-radius:5px}.produits li{margin:3px 0;font-size:13px}.total{font-size:17px;font-weight:bold;color:#e63946;text-align:right}.adresse{background:#fff3cd;padding:10px;border-radius:5px;margin:5px 0;font-size:13px}.actions{display:flex;gap:5px;margin-top:10px;flex-wrap:wrap}.action-btn{padding:8px 12px;border-radius:15px;font-size:12px;text-decoration:none;font-weight:bold;color:white}.btn-prete{background:#2a9d8f}.btn-livree{background:#6c757d}.btn-supprimer{background:#dc3545}.btn-attente{background:#f4a261}@media(max-width:600px){.stat-card{min-width:45%}}</style>';
      html += '<meta http-equiv="refresh" content="30"></head><body>';
      html += '<div class="header"><div><h1>📋 Dashboard Admin - Nems Saveurs</h1><p style="margin:5px 0 0;font-size:13px">Auto-refresh 30s</p></div><div class="header-btns"><a href="/export-csv" class="btn">📥 CSV</a><a href="/nettoyer-tout" class="btn" onclick="return confirm(\'Tout supprimer ?\')">🧹 Nettoyer</a></div></div>';
      html += '<div class="search"><form action="/" method="get"><input type="text" name="recherche" placeholder="🔍 Rechercher..." value="' + recherche + '"></form></div>';
      html += `<div class="stats"><div class="stat-card"><h3>📦 Total</h3><p>${totalCommandes}</p></div><div class="stat-card"><h3>💰 Revenus</h3><p>${totalRevenus.toLocaleString('fr-FR')} FCFA</p></div><div class="stat-card"><h3>👥 Clients</h3><p>${totalClients}</p></div><div class="stat-card"><h3>🚚 Livraisons</h3><p>${livraisons}</p></div><div class="stat-card"><h3>📍 Retraits</h3><p>${retraits}</p></div><div class="stat-card"><h3>⏳ En Attente</h3><p>${enAttente}</p></div></div>`;
      
      // Frais de livraison et stocks
      html += '<div style="display:flex;gap:15px;flex-wrap:wrap;margin-bottom:20px">';
      html += '<div style="background:white;border-radius:10px;padding:15px;box-shadow:0 2px 5px rgba(0,0,0,0.1)"><h3 style="margin:0 0 10px">🚚 Frais de livraison</h3><form action="/modifier-frais" method="get" style="display:flex;gap:5px"><input type="number" name="montant" value="' + frais.montant + '" style="padding:8px;border:1px solid #ddd;border-radius:5px;width:120px"><button type="submit" style="padding:8px 15px;background:#e63946;color:white;border:none;border-radius:5px;cursor:pointer">Modifier</button></form></div>';
      html += '<div style="background:white;border-radius:10px;padding:15px;box-shadow:0 2px 5px rgba(0,0,0,0.1)"><h3 style="margin:0 0 10px">📦 Stocks</h3><ul style="list-style:none;padding:0;margin:0">';
      Object.keys(stocks).forEach(k => {
        const nom = CATALOG[k] ? CATALOG[k].nom : k;
        html += `<li style="margin:5px 0;font-size:13px">${CATALOG[k].emoji} ${nom} : <strong>${stocks[k]}</strong></li>`;
      });
      html += '</ul></div>';
      html += '</div>';
      
      html += `<div class="filtres"><a href="/" class="filtre ${filtre==='toutes'?'active':''}">📋 Toutes</a><a href="/?filtre=livraison" class="filtre ${filtre==='livraison'?'active':''}">🚚 Livraisons</a><a href="/?filtre=retrait" class="filtre ${filtre==='retrait'?'active':''}">📍 Retraits</a><a href="/?filtre=en_attente" class="filtre ${filtre==='en_attente'?'active':''}">⏳ En Attente</a><a href="/?filtre=prete" class="filtre ${filtre==='prete'?'active':''}">✅ Prêtes</a><a href="/?filtre=livree" class="filtre ${filtre==='livree'?'active':''}">📦 Livrées</a></div>`;
      
      if (cmds.length === 0) html += '<p style="text-align:center;font-size:18px;color:#666">Aucune commande.</p>';
      else {
        cmds.slice().reverse().forEach(cmd => {
          const sc = cmd.typeRecuperation === 'livraison' ? 'statut-livraison' : 'statut-retrait';
          const si = cmd.typeRecuperation === 'livraison' ? '🚚' : '📍';
          const sbc = 'statut-' + cmd.statut;
          const cn = nettoyerNumero(cmd.clientWhatsApp);
          html += `<div class="c"><div class="c-header"><h2>📋 ${cmd.numeroCommande}</h2><div class="badges"><span class="${sc}">${si} ${cmd.typeRecuperation.toUpperCase()}</span><span class="${sbc}">${cmd.statut.replace(/_/g,' ').toUpperCase()}</span>${cmd.promo?`<span class="statut-prete">🎁 ${cmd.promo}</span>`:''}${cmd.livreur?`<span class="statut-retrait">🚚 ${cmd.livreur}</span>`:''}</div></div>`;
          html += `<div class="c-body"><p><strong>👤 Client :</strong> ${cn}</p><p><strong>📅 Date :</strong> ${new Date(cmd.date).toLocaleString('fr-FR')}</p><div class="produits"><strong>🛒 Produits :</strong><ul>`;
          cmd.produits.forEach(p => { html += `<li>${p.emoji} ${p.nom} × ${p.quantite} = ${p.prix.toLocaleString('fr-FR')} FCFA</li>`; });
          html += `</ul></div><p class="total">💰 Total : ${cmd.sousTotal.toLocaleString('fr-FR')} FCFA${cmd.fraisLivraison ? ` + ${cmd.fraisLivraison} FCFA livraison` : ''}</p>`;
          if (cmd.typeRecuperation === 'livraison') html += `<div class="adresse"><strong>📍 Adresse :</strong> ${cmd.adresse}${cmd.livreur ? `<br><strong>🚚 Livreur :</strong> ${cmd.livreur}` : ''}${cmd.fraisLivraison ? `<br><strong>💰 Frais :</strong> ${cmd.fraisLivraison} FCFA` : ''}</div>`;
          else html += '<div class="adresse"><strong>📍 Retrait :</strong> HLM FASS</div>';
          html += '<div class="actions">';
          if (cmd.statut === 'en_attente') html += `<a href="/changer-statut?cmd=${encodeURIComponent(cmd.numeroCommande)}&statut=prete" class="action-btn btn-prete">✅ Prête</a>`;
          if (cmd.statut === 'prete') html += `<a href="/changer-statut?cmd=${encodeURIComponent(cmd.numeroCommande)}&statut=livree" class="action-btn btn-livree">📦 Livrée</a>`;
          if (cmd.statut === 'livree') html += `<a href="/changer-statut?cmd=${encodeURIComponent(cmd.numeroCommande)}&statut=en_attente" class="action-btn btn-attente">⏳ Réactiver</a>`;
          html += `<a href="/supprimer?cmd=${encodeURIComponent(cmd.numeroCommande)}" class="action-btn btn-supprimer" onclick="return confirm(\'Supprimer ?\')">🗑️ Supprimer</a></div></div></div>`;
        });
      }
      html += '</body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end('404');
  });
  server.listen(3000, '0.0.0.0', () => {
    console.log('🖥️ Dashboard PC : http://localhost:3000');
    console.log('🔐 Mot de passe : nems2026');
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) console.log(`📱 Dashboard Téléphone : http://${iface.address}:3000`);
      }
    }
  });
}

async function startConnector(){
  const authDir = path.resolve(__dirname, '..', 'auth_info');
  if(!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  sockGlobal = makeWASocket({ 
    auth: state, version: version, browser: ['Nems Saveurs Bot', 'Desktop', '1.0.0'],
    markOnlineOnConnect: true, syncFullHistory: false,
    connectTimeoutMs: 60000, qrTimeout: 60000, defaultQueryTimeoutMs: 60000
  });
  sockGlobal.ev.on('creds.update', saveCreds);
  sockGlobal.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg || !msg.message || msg.key.fromMe) return;
      let jid = msg.key.remoteJid || '';
      if (jid === 'status@broadcast' || jid.includes('@broadcast') || jid.endsWith('@g.us')) return;
      if (jid.endsWith('@lid')) {
        const alt = msg.key.remoteJidAlt;
        if (alt && alt.endsWith('@s.whatsapp.net')) jid = alt;
        else return;
      }
      let texte = '';
      if (msg.message.conversation) texte = msg.message.conversation;
      else if (msg.message.extendedTextMessage) texte = msg.message.extendedTextMessage.text;
      if (!texte) return;
      console.log(`📩 ${jid}: "${texte}"`);
      const reponse = await traiterMessage(jid, texte);
      if (reponse) { await sockGlobal.sendMessage(jid, { text: reponse }); console.log(`📤 Réponse à ${jid}`); }
    } catch (err) { console.error('❌ Erreur message:', err.message); }
  });
  sockGlobal.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if(qr){
      console.log('\n=== SCANNEZ CE QR CODE ===\n');
      qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => { if(!err) console.log(url); });
      const out = path.resolve(__dirname, '..', 'data', 'wa-qr.png');
      await qrcode.toFile(out, qr, { type: 'png', scale: 6 });
      console.log('QR saved:', out);
    }
    if(connection === 'open'){ console.log('✅ WhatsApp connecté !'); demarrerServeurWeb(); }
    if(connection === 'close'){
      const statusCode = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output) ? lastDisconnect.error.output.statusCode : null;
      console.log('Fermé, code:', statusCode);
      if(statusCode === DisconnectReason.loggedOut){ fs.rmSync(authDir, { recursive: true, force: true }); console.log('Session supprimée. Relancez.'); }
    }
  });
}

if(require.main === module){
  startConnector().catch(err => { console.error('Erreur fatale:', err.message); process.exit(1); });
}

module.exports = { startConnector, traiterMessage, afficherPanier };