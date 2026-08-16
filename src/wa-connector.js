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
  let m = '📋 *NEMS SAVEURS - MENU OFFICIEL*\n━━━━━━━━━━━━━━━━━━━━━\n\n';
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
          await sockGlobal.sendMessage(userId, { text: '🛒 *VOTRE PANIER VOUS ATTEND !*\n━━━━━━━━━━━━━━━━━\n\n' + afficherPanier(userId) + '\n\n1️⃣ Confirmer\n2️⃣ Ajouter\n3️⃣ Vider' });
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
        await sockGlobal.sendMessage(userId, { text: '📋 *SUIVI DE VOTRE COMMANDE*\n━━━━━━━━━━━━━━━━━\n\n🔖 N° : *' + numeroCommande + '*\n\n✅ Votre commande a bien été reçue.\nNotre équipe la prépare avec soin 🥟❤️' });
      } catch (e) {}
    }
  }, 2 * 60 * 1000);
}

async function traiterMessage(userId, texte) {
  const t = texte.toLowerCase().trim();
  const etat = getEtat(userId);

  if (t.includes('equipe') || t.includes('parler') || t.includes('assistante')) {
    setEtat(userId, ETATS.ACCUEIL);
    return '📞 *ASSISTANCE*\n━━━━━━━━━━━━━━━━━\n\nJe vous mets en relation avec notre équipe 👩‍💼\nQuelqu\'un va vous répondre très rapidement.';
  }

  const promoMatch = PROMOTIONS.find(p => t.includes(p.code.toLowerCase()));
  if (promoMatch) {
    promoEnCours.set(userId, promoMatch);
    setEtat(userId, ETATS.ACCUEIL);
    return `🎁 *PROMOTION ACTIVÉE !*\n\n✅ Code *${promoMatch.code}* : ${promoMatch.description}\n\nContinuez votre commande !`;
  }

  switch(etat) {
    case ETATS.LIVRAISON:
      if (t.includes('livraison') || texte === '1') {
        setEtat(userId, ETATS.ADRESSE);
        return '🚚 *LIVRAISON*\n\nMerci de nous envoyer votre *adresse complète* 📍';
      }
      if (t.includes('retrait') || t.includes('recuperer') || texte === '2') {
        const produits = getPanier(userId).map(item => {
          const p = CATALOG[item.produitKey];
          return { nom: p.nom, emoji: p.emoji, quantite: item.quantite, prix: getPrix(item.produitKey, item.quantite) };
        });
        let sousTotal = produits.reduce((s, p) => s + p.prix, 0);
        const promo = promoEnCours.get(userId);
        if (promo) sousTotal = sousTotal - (sousTotal * promo.reduction / 100);
        
        const cmd = { numeroCommande: genererNumeroCommande('retrait'), clientWhatsApp: userId, produits, sousTotal: Math.round(sousTotal), typeRecuperation: 'retrait', adresse: '', statut: 'en_attente', date: new Date().toISOString(), promo: promo ? promo.code : null, livreur: null, fraisLivraison: null };
        sauvegarderCommande(cmd);
        const clients = enregistrerClient(userId);
        clients[userId].totalDepense += Math.round(sousTotal);
        sauvegarderClients(clients);
        promoEnCours.delete(userId);
        paniers.delete(userId);
        setEtat(userId, ETATS.ACCUEIL);
        demarrerSuiviCommande(userId, cmd.numeroCommande);
        return `✅ *COMMANDE CONFIRMÉE !*\n\n🔖 N° : *${cmd.numeroCommande}*\n\n📍 Retrait : HLM FASS\n\nNous vous confirmerons quand c'est prêt ❤️`;
      }
      return '📌 *MODE DE RÉCUPÉRATION*\n1️⃣ 🚚 Livraison\n2️⃣ 📍 Retrait';

    case ETATS.ADRESSE:
      const produits = getPanier(userId).map(item => {
        const p = CATALOG[item.produitKey];
        return { nom: p.nom, emoji: p.emoji, quantite: item.quantite, prix: getPrix(item.produitKey, item.quantite) };
      });
      let sousTotal = produits.reduce((s, p) => s + p.prix, 0);
      const promo = promoEnCours.get(userId);
      if (promo) sousTotal = sousTotal - (sousTotal * promo.reduction / 100);
      const livreur = assignerLivreur(texte);
      const frais = chargerFrais();
      
      const cmd = { numeroCommande: genererNumeroCommande('livraison'), clientWhatsApp: userId, produits, sousTotal: Math.round(sousTotal), typeRecuperation: 'livraison', adresse: texte, statut: 'en_attente', date: new Date().toISOString(), promo: promo ? promo.code : null, livreur: livreur ? livreur.nom : null, fraisLivraison: frais.montant };
      sauvegarderCommande(cmd);
      const clients = enregistrerClient(userId);
      clients[userId].totalDepense += Math.round(sousTotal);
      sauvegarderClients(clients);
      promoEnCours.delete(userId);
      paniers.delete(userId);
      setEtat(userId, ETATS.ACCUEIL);
      
      if (livreur && sockGlobal) {
        try {
          await sockGlobal.sendMessage(livreur.telephone + '@s.whatsapp.net', { text: `🚚 *NOUVELLE LIVRAISON*\n\n📋 ${cmd.numeroCommande}\n📍 ${texte}\n🛒 ${produits.map(p => `${p.emoji} ${p.nom} ×${p.quantite}`).join(', ')}\n💰 ${Math.round(sousTotal)} FCFA` });
        } catch (e) {}
      }
      
      demarrerSuiviCommande(userId, cmd.numeroCommande);
      return `✅ *COMMANDE ENREGISTRÉE !*\n\n🔖 N° : *${cmd.numeroCommande}*\n\n📍 ${texte}\n${livreur ? `🚚 Livreur : *${livreur.nom}*` : ''}\n🚚 Frais : *${frais.montant} FCFA*`;

    case ETATS.PANIER:
      if (t.includes('confirmer') || t.includes('valider') || t === 'oui' || texte === '1') {
        setEtat(userId, ETATS.LIVRAISON);
        return afficherPanier(userId) + '\n\n1️⃣ 🚚 Livraison\n2️⃣ 📍 Retrait';
      }
      if (t.includes('annuler') || t.includes('vider')) {
        paniers.delete(userId);
        setEtat(userId, ETATS.ACCUEIL);
        return '🗑️ Panier vidé. Tapez *menu* pour voir le catalogue.';
      }
      {
        const cmds = parserCommande(texte);
        if (cmds.length > 0) {
          let rep = '✅ *AJOUTÉ AU PANIER*\n\n';
          cmds.forEach(c => {
            const r = ajouterAuPanier(userId, c.produitKey, c.quantite);
            if (r.success) rep += `${CATALOG[c.produitKey].emoji} ${CATALOG[c.produitKey].nom} × ${c.quantite}\n`;
            else rep += r.message + '\n';
          });
          rep += '\n' + afficherPanier(userId) + '\n\n1️⃣ Confirmer\n2️⃣ Ajouter\n3️⃣ Vider';
          demarrerRelancePanier(userId);
          return rep;
        }
      }
      return 'Confirmer, ajouter ou vider le panier ?';

    default:
      if (t.includes('bonjour') || t.includes('salut') || t.includes('bonsoir')) {
        await sockGlobal.sendMessage(userId, { text: '👋 *BIENVENUE CHER(E) CLIENT(E)*\n━━━━━━━━━━━━━━━━━━━━━━\n\n🥟 *NEMS SAVEURS*\nVotre goût authentique du nems 100% asiatique\n\n📌 *OPTIONS :*\n1️⃣ 📋 Consulter le Menu\n2️⃣ 🛒 Passer une Commande\n3️⃣ 📞 Parler à notre Équipe\n\n💡 Répondez par 1, 2 ou 3' });
        return null;
      }
      if (t.includes('menu') || t.includes('catalogue')) return afficherCatalogue();
      if (t.includes('commande') || t.includes('commander')) {
        setEtat(userId, ETATS.PANIER);
        return '🛒 *PASSER UNE COMMANDE*\n\n' + afficherCatalogue();
      }
      {
        const cmds = parserCommande(texte);
        if (cmds.length > 0) {
          setEtat(userId, ETATS.PANIER);
          let rep = '✅ *COMMANDE REÇUE*\n\n';
          cmds.forEach(c => {
            const r = ajouterAuPanier(userId, c.produitKey, c.quantite);
            if (r.success) rep += `${CATALOG[c.produitKey].emoji} ${CATALOG[c.produitKey].nom} × ${c.quantite}\n`;
            else rep += r.message + '\n';
          });
          rep += '\n' + afficherPanier(userId) + '\n\n1️⃣ Confirmer\n2️⃣ Ajouter\n3️⃣ Vider';
          demarrerRelancePanier(userId);
          return rep;
        }
      }
      return '❓ *Je n\'ai pas compris*\n\n1️⃣ Menu → "menu"\n2️⃣ Commander → "20 nems cuits"\n3️⃣ Assistance → "equipe"';
  }
}

// ============ DASHBOARD ============
function nettoyerNumero(jid) {
  const chiffres = jid.replace(/[^0-9]/g, '');
  if (chiffres.length >= 9) return `+${chiffres.slice(0, 3)} ${chiffres.slice(3, 5)} ${chiffres.slice(5, 8)} ${chiffres.slice(8, 10)} ${chiffres.slice(10)}`;
  return jid;
}

const http = require('http');
function demarrerServeurWeb() {
  const server = http.createServer((req, res) => {
    if (req.url === '/login' || req.url === '/login?erreur=1') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          if (params.get('password') === ADMIN_PASSWORD) {
            const sid = genererSessionId();
            sessions.set(sid, true);
            res.writeHead(302, { 'Location': '/', 'Set-Cookie': `session=${sid}; HttpOnly; Path=/` });
            res.end();
          } else {
            res.writeHead(302, { 'Location': '/login?erreur=1' });
            res.end();
          }
        });
        return;
      }
      let html = '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Connexion Admin</title>';
      html += '<style>body{font-family:sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.login-box{background:white;border-radius:15px;padding:30px;box-shadow:0 5px 20px rgba(0,0,0,0.1);width:100%;max-width:400px;text-align:center}.login-box input{width:100%;padding:15px;border:1px solid #ddd;border-radius:8px;font-size:16px;margin-bottom:15px}.login-box button{width:100%;padding:15px;background:#e63946;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer}</style></head><body>';
      html += '<div class="login-box"><h1>🔐 Admin Nems Saveurs</h1><p>Entrez votre mot de passe</p>';
      if (req.url.includes('erreur=1')) html += '<p style="color:red">❌ Mot de passe incorrect !</p>';
      html += '<form method="POST" action="/login"><input type="password" name="password" placeholder="Mot de passe" required><button type="submit">Se connecter</button></form></div></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (!verifierSession(req)) {
      res.writeHead(302, { 'Location': '/login' });
      res.end();
      return;
    }

    if (req.url === '/commandes') {
      let cmds = [];
      if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(cmds, null, 2));
      return;
    }
    if (req.url === '/stocks') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(chargerStocks(), null, 2));
      return;
    }
    if (req.url === '/frais') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(chargerFrais(), null, 2));
      return;
    }
    if (req.url === '/clients') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(chargerClients(), null, 2));
      return;
    }
    if (req.url === '/' || req.url.startsWith('/?filtre=')) {
      const url = new URL(req.url, 'http://localhost');
      const filtre = url.searchParams.get('filtre') || 'toutes';
      let cmds = [];
      if (fs.existsSync(COMMANDES_FILE)) cmds = JSON.parse(fs.readFileSync(COMMANDES_FILE, 'utf8'));
      if (filtre === 'livraison') cmds = cmds.filter(c => c.typeRecuperation === 'livraison');
      if (filtre === 'retrait') cmds = cmds.filter(c => c.typeRecuperation === 'retrait');
      if (filtre === 'en_attente') cmds = cmds.filter(c => c.statut === 'en_attente');
      
      const total = cmds.length;
      const revenus = cmds.reduce((s, c) => s + c.sousTotal, 0);
      const frais = chargerFrais();
      const stocks = chargerStocks();
      
      let html = '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dashboard Nems Saveurs</title>';
      html += '<style>*{box-sizing:border-box}body{font-family:sans-serif;padding:15px;background:#f5f5f5;margin:0}.header{background:#e63946;color:white;padding:20px;border-radius:10px;margin-bottom:20px}.stats{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}.stat-card{background:white;border-radius:10px;padding:15px;flex:1;min-width:130px;text-align:center;box-shadow:0 2px 5px rgba(0,0,0,0.1)}.stat-card p{font-size:22px;font-weight:bold;color:#e63946;margin:5px 0 0}.c{background:white;border-radius:10px;padding:15px;margin:10px 0;box-shadow:0 2px 5px rgba(0,0,0,0.1)}</style></head><body>';
      html += '<div class="header"><h1>📋 Dashboard Admin - Nems Saveurs</h1></div>';
      html += `<div class="stats"><div class="stat-card"><h3>📦 Total</h3><p>${total}</p></div><div class="stat-card"><h3>💰 Revenus</h3><p>${revenus.toLocaleString('fr-FR')} FCFA</p></div><div class="stat-card"><h3>🚚 Frais</h3><p>${frais.montant} FCFA</p></div></div>`;
      html += '<div style="background:white;border-radius:10px;padding:15px;margin-bottom:20px"><h3>📦 Stocks</h3><ul>';
      Object.keys(stocks).forEach(k => { html += `<li>${CATALOG[k].emoji} ${CATALOG[k].nom} : <strong>${stocks[k]}</strong></li>`; });
      html += '</ul></div>';
      
      if (cmds.length === 0) html += '<p style="text-align:center;color:#666">Aucune commande.</p>';
      else {
        cmds.slice().reverse().forEach(cmd => {
          html += `<div class="c"><h2>📋 ${cmd.numeroCommande} - ${cmd.statut.toUpperCase()}</h2><p>👤 ${nettoyerNumero(cmd.clientWhatsApp)}</p><p>📅 ${new Date(cmd.date).toLocaleString('fr-FR')}</p><ul>`;
          cmd.produits.forEach(p => { html += `<li>${p.emoji} ${p.nom} × ${p.quantite} = ${p.prix} FCFA</li>`; });
          html += `</ul><p><strong>Total : ${cmd.sousTotal} FCFA</strong></p>`;
          if (cmd.typeRecuperation === 'livraison') html += `<p>📍 ${cmd.adresse}${cmd.livreur ? ` - 🚚 ${cmd.livreur}` : ''}</p>`;
          else html += '<p>📍 Retrait HLM FASS</p>';
          html += '</div>';
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
  });
}

async function startConnector(){
  const authDir = path.resolve(__dirname, '..', 'auth_info');
  if (process.env.FORCE_NEW_SESSION === 'true') {
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
    console.log('🗑️ Ancienne session supprimée (FORCE_NEW_SESSION)');
  }
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