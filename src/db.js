const fs = require('fs');
const path = require('path');

const ORDERS_FILE = path.join(__dirname, '..', 'data', 'orders.json');

function ensure(){
  const dir = path.dirname(ORDERS_FILE);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir);
  if(!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify([],null,2));
}

function loadOrders(){ ensure(); return JSON.parse(fs.readFileSync(ORDERS_FILE,'utf8')||'[]'); }
function saveOrders(orders){ ensure(); fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders,null,2)); }

module.exports = { ORDERS_FILE, ensure, loadOrders, saveOrders };
