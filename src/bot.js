const fs = require('fs');
const path = require('path');
const { sanitizeText, wordsToNumber } = require('./utils');
const catalogue = require('./catalogue.json');
const db = require('./db');

const carts = new Map(); // key: phone, value: [{productKey, qty, price}]
const awaitingDelivery = new Map(); // phone -> true when waiting for address

function findProductKeyFromText(text){
  const t = text.toLowerCase();
  // nems
  if(/\bnem\b|\bnems\b/.test(t)){
    if(/non cuits|pas cuits|non\b|non cuits/.test(t)) return 'nems_non_cuits';
    if(/\bcuits?\b/.test(t)) return 'nems_cuits';
    return null; // ambiguous
  }
  // beignets crevettes
  if(/beignet|crevette/.test(t)){
    if(/non cuits|non\b|pas cuits/.test(t)) return 'beignets_crevettes_non_cuits';
    if(/\bcuits?\b/.test(t)) return 'beignets_crevettes_cuits';
    return 'beignets_crevettes_non_cuits';
  }
  return null;
}

function parseOrdersFromText(text){
  const clean = sanitizeText(text);
  if(!clean) return { found:false };
  const lower = clean.toLowerCase();
  const parts = lower.split(/,|\+| et | et\s+|\s+et\s+|;|\/|\band\b/).map(p=>p.trim()).filter(Boolean);
  const results = [];
  for(const part of parts){
    // try digits
    let qty = null;
    const numMatch = part.match(/(\d+)\b/);
    if(numMatch) qty = parseInt(numMatch[1],10);
    else qty = wordsToNumber(part);

    const key = findProductKeyFromText(part) || findProductKeyFromText(lower);
    if(!key){
      // skip ambiguous parts to avoid inventing
      continue;
    }
    if(!qty) {
      results.push({ error: `Quantité introuvable pour ${catalogue.products[key].displayName}. Veuillez indiquer une quantité valide.` });
      continue;
    }
    const prices = catalogue.products[key].prices;
    const allowed = Object.keys(prices).map(n=>parseInt(n,10));
    if(!allowed.includes(qty)){
      results.push({ error: `Nos ${catalogue.products[key].displayName.toLowerCase()} sont disponibles par quantité de ${allowed.join(', ')}.` });
      continue;
    }
    results.push({ productKey: key, qty, price: prices[String(qty)] });
  }
  if(results.length===0) return { found:false };
  return { found:true, items: results };
}
function ensureCart(phone){
  if(!carts.has(phone)) carts.set(phone, []);
  return carts.get(phone);
}

function addToCart(phone, productKey, qty){
  const cart = ensureCart(phone);
  const prices = catalogue.products[productKey].prices;
  const price = prices[String(qty)];
  cart.push({productKey, qty, price});
  return true;
}

function modifyCartItem(phone, index, newQty){
  const cart = carts.get(phone) || [];
  if(index<0 || index>=cart.length) return { error: 'Article introuvable dans le panier.' };
  const item = cart[index];
  const prices = catalogue.products[item.productKey].prices;
  if(!prices[String(newQty)]) return { error: 'Quantité non disponible pour ce produit.' };
  item.qty = newQty;
  item.price = prices[String(newQty)];
  return { ok:true };
}

function removeCartItem(phone, index){
  const cart = carts.get(phone) || [];
  if(index<0 || index>=cart.length) return { error: 'Article introuvable dans le panier.' };
  cart.splice(index,1);
  return { ok:true };
}

function getCartSummary(phone){
  const cart = carts.get(phone) || [];
  if(cart.length===0) return 'Votre panier est vide.';
  let lines = ['🛒 VOTRE PANIER',''];
  let total = 0;
  cart.forEach((item,idx)=>{
    const name = catalogue.products[item.productKey].displayName;
    lines.push(`${idx+1}. ${name} × ${item.qty}`);
    lines.push(`${item.price.toLocaleString('fr-FR')} FCFA`);
    lines.push('');
    total += item.price;
  });
  lines.push(`Sous-total : ${total.toLocaleString('fr-FR')} FCFA`);
  return lines.join('\n');
}

function getCartTotals(phone){
  const cart = carts.get(phone) || [];
  let total = 0;
  cart.forEach(i=> total += i.price);
  return { total, count: cart.length };
}

function resetCart(phone){
  carts.delete(phone);
}

function confirmCart(phone, client){
  const cart = carts.get(phone) || [];
  if(cart.length===0) return { error: 'Panier vide' };
  const orders = db.loadOrders();
  const subtotal = cart.reduce((s,i)=>s+i.price,0);
  const order = {
    id: `CMD-${Date.now()}`,
    client: { name: client && client.name ? client.name : null, phone },
    items: cart,
    subtotal,
    deliveryType: client && client.deliveryType ? client.deliveryType : null,
    address: client && client.address ? client.address : null,
    deliveryFee: client && client.deliveryFee ? client.deliveryFee : null,
    total: subtotal + (client && client.deliveryFee ? client.deliveryFee : 0),
    status: client && client.deliveryType === 'livraison' ? 'LIVRAISON À CONFIRMER' : 'PRÊT POUR RETRAIT',
    createdAt: new Date().toISOString()
  };
  orders.push(order);
  db.saveOrders(orders);
  resetCart(phone);
  if(awaitingDelivery.has(phone)) awaitingDelivery.delete(phone);
  return { ok:true, order };
}

function getAllowedQuantities(productKey){
  const prices = catalogue.products[productKey].prices;
  if(!prices) return [];
  return Object.keys(prices).map(n=>parseInt(n,10));
}

module.exports = {
  parseOrdersFromText,
  addToCart,
  getCartSummary,
  resetCart,
  getAllowedQuantities,
  modifyCartItem,
  removeCartItem,
  confirmCart,
  getCartTotals,
  listOrders,
  getOrderById,
  updateOrderDelivery,
  _internal: { carts }
};

function listOrders(){ return db.loadOrders(); }
function getOrderById(id){ const orders = db.loadOrders(); return orders.find(o=>o.id===id) || null; }
function updateOrderDelivery(id, deliveryFee, status){
  const orders = db.loadOrders();
  const idx = orders.findIndex(o=>o.id===id);
  if(idx===-1) return { error: 'Commande introuvable' };
  orders[idx].deliveryFee = deliveryFee;
  orders[idx].total = orders[idx].subtotal + (deliveryFee||0);
  if(status) orders[idx].status = status;
  db.saveOrders(orders);
  return { ok:true, order: orders[idx] };
}

// Delivery address flow
function setAwaitingDelivery(phone){
  awaitingDelivery.set(phone, true);
}

function isAwaitingDelivery(phone){
  return awaitingDelivery.has(phone);
}

function receiveAddress(phone, address){
  // Confirm the cart as a delivery order, persist and clear awaiting flag
  const result = confirmCart(phone, { deliveryType: 'livraison', address });
  if(result.error) return { error: result.error };
  return { ok:true, order: result.order };
}
