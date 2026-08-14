require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bot = require('./bot');
const catalogue = require('./catalogue.json');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.get('/', (req,res)=>{
  res.send('Nems Saveurs Bot - prototype');
});

// Simple webhook endpoint. Expect JSON: { from: '<phone>', text: '<message>' }
app.post('/webhook', (req,res)=>{
  const { from, text } = req.body || {};
  if(!from || !text) return res.status(400).json({ error: 'Missing from or text' });

  const lower = text.toLowerCase();

  // If user is expected to send address, handle it first
  if(bot.isAwaitingDelivery(from)){
    const addr = text.trim();
    const result = bot.receiveAddress(from, addr);
    if(result.error) return res.json({ reply: result.error });
    // Notify user that order is recorded and assistant will calculate delivery
    return res.json({ reply: `Merci, votre adresse a été reçue. Nous transmettons la commande à notre assistante.\n\nNuméro de commande : ${result.order.id}\nStatut : ${result.order.status}` });
  }

  // Transfer to human
  if(/parler|quelquun|quelqu'un|assistante|humain|operator/.test(lower)){
    return res.json({ reply: "Je vous transfère à notre équipe. Un membre va prendre le relais. 👩‍💼" });
  }

  // view menu
  if(/voir le menu|menu|voir le catalogue|1\b/.test(lower)){
    const cat = require('./catalogue.json');
    let lines = ['📜 MENU'];
    for(const key of Object.keys(cat.products)){
      const p = cat.products[key];
      lines.push('');
      lines.push(p.displayName);
      for(const q of Object.keys(p.prices)){
        lines.push(`${q} → ${p.prices[q].toLocaleString('fr-FR')} FCFA`);
      }
    }
    return res.json({ reply: lines.join('\n') });
  }

  // show cart
  if(/mon panier|voir mon panier|voir le panier|panier/.test(lower)){
    return res.json({ reply: bot.getCartSummary(from) });
  }

  // confirm order
  if(/confirmer|1️⃣ confir|confirm/i.test(lower)){
    // simple confirm without address = retrait
    const confirm = bot.confirmCart(from, { deliveryType: 'retrait' });
    if(confirm.error) return res.json({ reply: confirm.error });
    return res.json({ reply: `Commande enregistrée. Numéro : ${confirm.order.id}` });
  }

  // livraison
  if(/livraison/.test(lower)){
    bot.setAwaitingDelivery(from);
    return res.json({ reply: "Parfait 👍\n\nVeuillez nous envoyer votre adresse de livraison ainsi qu'un point de repère si possible. 📍" });
  }

  // retrait
  if(/retrait|je viens recuperer|je viens récupérer|retirer/.test(lower)){
    return res.json({ reply: "Parfait 👍\n\nVotre commande sera préparée pour retrait.\n\n📍 Point de retrait : HLM FASS\n\nNous vous confirmerons lorsque votre commande sera prête. ❤️" });
  }

  // parse orders (may be multi-product)
  // modification or suppression commands
  const modMatch = text.match(/modifier\s+article\s*(\d+)\s*(?:a|à|=|to)?\s*(\d+)/i);
  if(modMatch){
    const idx = parseInt(modMatch[1],10)-1;
    const newQty = parseInt(modMatch[2],10);
    const res = bot.modifyCartItem(from, idx, newQty);
    if(res.error) return res.json({ reply: res.error });
    return res.json({ reply: bot.getCartSummary(from) });
  }
  const delMatch = text.match(/(?:supprimer|retirer|enlever)\s+article\s*(\d+)/i);
  if(delMatch){
    const idx = parseInt(delMatch[1],10)-1;
    const res = bot.removeCartItem(from, idx);
    if(res.error) return res.json({ reply: res.error });
    return res.json({ reply: bot.getCartSummary(from) });
  }

  const parsed = bot.parseOrdersFromText(text);
  if(parsed.found){
    if(parsed.items && parsed.items.length>0){
      let anyError = null;
      parsed.items.forEach(it=>{
        if(it.error) anyError = it.error;
        else bot.addToCart(from, it.productKey, it.qty);
      });
      if(anyError) return res.json({ reply: anyError });
      return res.json({ reply: bot.getCartSummary(from) });
    }
    return res.json({ reply: "Je n'ai pas pu extraire d'article utilisable de votre message." });
  }

  // greetings
  if(/bonjour|salut|hello/i.test(text)){
    return res.json({ reply: "Bonjour 👋 Bienvenue chez Nems Saveurs ❤️\n\nQue souhaitez-vous faire ?\n1️⃣ Voir le menu\n2️⃣ Passer une commande\n3️⃣ Obtenir des informations\n4️⃣ Parler à notre équipe" });
  }

  return res.json({ reply: "Je préfère vous mettre en relation avec notre équipe afin de vous donner une réponse exacte. 👩‍💼" });
});

// Basic Auth middleware for admin/assistant
function checkAdminAuth(req,res,next){
  const auth = req.header('authorization');
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
  if(!auth || !auth.startsWith('Basic ')){
    res.set('WWW-Authenticate','Basic realm="Assistant"');
    return res.status(401).send('Unauthorized');
  }
  const creds = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
  const [user,pass] = creds.split(':');
  if(user !== ADMIN_USER || pass !== ADMIN_PASS){
    res.set('WWW-Authenticate','Basic realm="Assistant"');
    return res.status(401).send('Unauthorized');
  }
  next();
}

// Admin: lister les commandes (JSON)
app.get('/admin/orders', checkAdminAuth, (req,res)=>{
  const orders = bot.listOrders();
  res.json({ orders });
});

// Admin: définir les frais de livraison et statut pour une commande (JSON)
app.post('/admin/orders/:id/delivery', checkAdminAuth, (req,res)=>{
  const id = req.params.id;
  const { deliveryFee, status } = req.body || {};
  const result = bot.updateOrderDelivery(id, deliveryFee, status);
  if(result.error) return res.status(404).json(result);
  res.json(result);
});

// Assistante: interface simple
app.get('/assistant', checkAdminAuth, (req,res)=>{
  const orders = bot.listOrders();
  let html = `<!doctype html><html><head><meta charset="utf-8"><title>Assistante - Nems Saveurs</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet"></head><body><div class="container py-4"><h1>Commandes</h1>`;
  if(orders.length===0) html += '<p>Aucune commande.</p>';
  orders.forEach(o=>{
    html += `<div class="card my-3"><div class="card-body"><h5 class="card-title">${o.id} — ${o.client.phone}</h5>`;
    html += `<p>${o.items.map(it=>`${catalogue.products[it.productKey].displayName} × ${it.qty}`).join('<br>')}</p>`;
    html += `<p>Produits: ${o.subtotal.toLocaleString('fr-FR')} FCFA<br>Frais livraison: ${o.deliveryFee? o.deliveryFee.toLocaleString('fr-FR')+' FCFA':'—'}<br>Total: ${o.total? o.total.toLocaleString('fr-FR')+' FCFA':''}<br>Statut: ${o.status}</p>`;
    html += `<form method="post" action="/assistant/orders/${o.id}/update" class="row g-2 align-items-end"><div class="col-auto"><label class="form-label">Frais livraison</label><input name="deliveryFee" class="form-control" type="number" value="${o.deliveryFee||''}"/></div><div class="col-auto"><label class="form-label">Statut</label><select name="status" class="form-select"><option ${o.status==='LIVRAISON À CONFIRMER'?'selected':''}>LIVRAISON À CONFIRMER</option><option ${o.status==='CONFIRMÉ'?'selected':''}>CONFIRMÉ</option><option ${o.status==='PRÊT POUR RETRAIT'?'selected':''}>PRÊT POUR RETRAIT</option><option ${o.status==='ANNULÉ'?'selected':''}>ANNULÉ</option></select></div><div class="col-auto"><button class="btn btn-primary">Mettre à jour</button></div></form>`;
    html += `</div></div>`;
  });
  html += '</div></body></html>';
  res.send(html);
});

// Assistante: mise à jour via formulaire
app.post('/assistant/orders/:id/update', checkAdminAuth, bodyParser.urlencoded({extended:false}), (req,res)=>{
  const id = req.params.id;
  const deliveryFee = req.body.deliveryFee ? parseFloat(req.body.deliveryFee) : 0;
  const status = req.body.status;
  const result = bot.updateOrderDelivery(id, deliveryFee, status);
  if(result.error) return res.status(404).send('Commande introuvable');
  res.redirect('/assistant');
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>{
  console.log(`Nems Saveurs Bot listening on port ${port}`);
});
