const fs = require('fs');
const path = require('path');
const bot = require('../src/bot');

const ORDERS_FILE = path.join(__dirname, '..', 'data', 'orders.json');

beforeAll(()=>{
  // ensure clean orders file for tests
  const dir = path.join(__dirname, '..', 'data');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([],null,2));
});

afterEach(()=>{
  // clear carts map
  const carts = bot._internal.carts;
  carts.clear();
});

test('parse single order valid quantity', ()=>{
  const res = bot.parseOrdersFromText('Je veux 20 nems cuits');
  expect(res.found).toBeTruthy();
  expect(res.items).toBeDefined();
  expect(res.items[0].productKey).toBe('nems_cuits');
  expect(res.items[0].qty).toBe(20);
  expect(res.items[0].price).toBe(6000);
});

test('parse invalid quantity returns error', ()=>{
  const res = bot.parseOrdersFromText('Je veux 7 nems cuits');
  expect(res.found).toBeTruthy();
  expect(res.items[0].error).toMatch(/disponibles/);
});

test('add to cart and summary', ()=>{
  const phone = 'test-1';
  bot.addToCart(phone, 'nems_cuits', 20);
  const summary = bot.getCartSummary(phone);
  expect(summary).toMatch(/Nems cuits/);
  expect(summary).toMatch(/6[\s\u202F]?000 FCFA/);
});

test('confirm cart persists order', ()=>{
  const phone = 'test-2';
  bot.addToCart(phone, 'nems_non_cuits', 10);
  const result = bot.confirmCart(phone, { deliveryType: 'retrait' });
  expect(result.ok).toBeTruthy();
  expect(result.order).toBeDefined();
  const orders = JSON.parse(fs.readFileSync(ORDERS_FILE));
  const found = orders.find(o=>o.id === result.order.id);
  expect(found).toBeDefined();
  expect(found.status).toBe('PRÊT POUR RETRAIT');
});

test('parse numbers in words and multi-product', ()=>{
  const res = bot.parseOrdersFromText('Salut je veux vingt nems cuits et dix beignets crevettes non cuits');
  expect(res.found).toBeTruthy();
  expect(res.items.length).toBeGreaterThanOrEqual(2);
  const keys = res.items.map(i=>i.productKey).sort();
  expect(keys).toContain('nems_cuits');
  expect(keys).toContain('beignets_crevettes_non_cuits');
});

