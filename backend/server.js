require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { apigwClient } = require('selcom-apigw-client');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ─────────────────────────────────────────────────────────────────
// SELCOM CLIENT
// Get credentials from https://developers.selcommobile.com
// Contact info@selcom.net for API access
// ─────────────────────────────────────────────────────────────────
const selcom = new apigwClient(
  process.env.SELCOM_BASE_URL,    // sandbox: https://apigwtest.selcommobile.com
  process.env.SELCOM_API_KEY,
  process.env.SELCOM_API_SECRET
);

// ─────────────────────────────────────────────────────────────────
// IN-MEMORY DB  (swap out Maps for PostgreSQL/MySQL in production)
//
// SQL schema suggestion:
//
// CREATE TABLE orders (
//   id SERIAL PRIMARY KEY,
//   order_id TEXT UNIQUE NOT NULL,
//   phone TEXT, name TEXT, company TEXT, email TEXT,
//   plan TEXT, amount INTEGER,
//   status TEXT DEFAULT 'pending',
//   selcom_ref TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE TABLE subscriptions (
//   phone TEXT PRIMARY KEY, plan TEXT,
//   name TEXT, company TEXT,
//   active_until TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE TABLE scores (
//   id SERIAL PRIMARY KEY,
//   phone TEXT, name TEXT, company TEXT,
//   category TEXT, difficulty TEXT,
//   score INT, total INT, best_streak INT,
//   ai_generated BOOLEAN DEFAULT FALSE,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// ─────────────────────────────────────────────────────────────────
const db = {
  orders:        new Map(),  // order_id → order record
  subscriptions: new Map(),  // phone    → subscription record
  scores:        [],
};

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function genOrderId() {
  return `HR-${Date.now()}`;
}

// Accepts: 0712345678 | 712345678 | 255712345678 → 255712345678
function formatPhone(phone) {
  const clean = String(phone).replace(/[\s\+\-]/g, '');
  if (clean.startsWith('255')) return clean;
  if (clean.startsWith('0'))   return '255' + clean.slice(1);
  return '255' + clean;
}

function activateSubscription(order) {
  const activeUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  db.subscriptions.set(order.phone, {
    plan: order.plan, name: order.name, company: order.company,
    activeUntil, activatedAt: new Date(),
  });
  console.log(`✅ Subscription activated | ${order.company} | Plan: ${order.plan} | Until: ${activeUntil.toDateString()}`);
}

// ─────────────────────────────────────────────────────────────────
// 1. CREATE ORDER  →  POST /api/payment/create-order
//    Creates a Selcom Checkout order and returns the payment URL.
//    Frontend opens this URL (new tab or WebView) to let the user pay
//    with M-Pesa, Airtel Money, Tigo Pesa, card — Selcom handles all.
// ─────────────────────────────────────────────────────────────────
app.post('/api/payment/create-order', async (req, res) => {
  const { phone, name, company, email, plan, amount } = req.body;

  if (!phone || !name || !plan || !amount) {
    return res.status(400).json({ success: false, message: 'phone, name, plan and amount are required' });
  }

  const order_id       = genOrderId();
  const formattedPhone = formatPhone(phone);

  // Persist order before calling Selcom (so webhook can match it)
  db.orders.set(order_id, {
    order_id, phone: formattedPhone, name,
    company: company || '', email: email || '',
    plan, amount, status: 'pending', selcomRef: null, createdAt: new Date(),
  });

  const payload = {
    vendor:           process.env.SELCOM_VENDOR,
    order_id,
    buyer_email:      email || `${formattedPhone}@hireready.co.tz`,
    buyer_name:       name,
    buyer_phone:      formattedPhone,
    amount,
    currency:         'TZS',
    buyer_remarks:    `HireReady ${plan} subscription`,
    merchant_remarks: `Plan: ${plan}`,
    no_of_items:      1,
    webhook:          process.env.SELCOM_WEBHOOK_URL,   // Selcom POSTs result here
    cancel_url:       process.env.SELCOM_CANCEL_URL,    // redirect on cancel
  };

  try {
    const response = await selcom.postFunc('/v1/checkout/create-order-minimal', payload);
    const data      = response?.data?.[0] || {};
    const gatewayUrl = data.payment_gateway_url;

    if (response?.result !== 'SUCCESS' || !gatewayUrl) {
      console.error('Selcom order failed:', response);
      db.orders.get(order_id).status = 'failed';
      return res.status(502).json({
        success: false,
        message: response?.message || 'Failed to create payment order',
        detail:  response,
      });
    }

    db.orders.get(order_id).selcomRef = data.reference || null;
    console.log(`📦 Order created | ${order_id} | ${plan} | TZS ${amount} | ${name}`);

    res.json({
      success:    true,
      order_id,
      gatewayUrl,   // ← open this URL in the browser for the customer to pay
      message:    'Redirect user to gatewayUrl to complete payment',
    });

  } catch (err) {
    console.error('create-order error:', err.message);
    res.status(500).json({ success: false, message: 'Gateway error', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2. SELCOM WEBHOOK  →  POST /api/payment/webhook
//    Selcom POSTs here when the customer completes or cancels payment.
//    URL must be publicly reachable — use ngrok in development:
//      ngrok http 3000
//      set SELCOM_WEBHOOK_URL=https://xxxx.ngrok.io/api/payment/webhook
// ─────────────────────────────────────────────────────────────────
app.post('/api/payment/webhook', (req, res) => {
  try {
    const payload = req.body;
    console.log('🔔 Selcom webhook received:', JSON.stringify(payload, null, 2));

    const order_id   = payload.order_id  || payload.transid;
    const resultcode = payload.resultcode || payload.result_code;
    const selcomRef  = payload.reference  || payload.selcom_reference;

    if (!order_id) {
      return res.json({ result: 'SUCCESS', resultcode: '000', message: 'Acknowledged' });
    }

    const order = db.orders.get(order_id);
    if (!order) {
      console.warn(`⚠️  Webhook for unknown order: ${order_id}`);
      return res.json({ result: 'SUCCESS', resultcode: '000', message: 'Acknowledged' });
    }

    if (resultcode === '000') {
      order.status    = 'success';
      order.selcomRef = selcomRef || order.selcomRef;
      db.orders.set(order_id, order);
      activateSubscription(order);
    } else {
      order.status = 'failed';
      db.orders.set(order_id, order);
      console.log(`❌ Payment failed | ${order_id} | Code: ${resultcode}`);
    }

  } catch (err) {
    console.error('Webhook error:', err.message);
  }

  // Always respond 200 — Selcom retries if we don't
  res.json({ result: 'SUCCESS', resultcode: '000', message: 'Acknowledged' });
});

// ─────────────────────────────────────────────────────────────────
// 3. POLL ORDER STATUS  →  GET /api/payment/status/:order_id
//    Frontend polls every 3 s while showing "waiting for payment…"
//    If webhook hasn't arrived, we also query Selcom directly.
// ─────────────────────────────────────────────────────────────────
app.get('/api/payment/status/:order_id', async (req, res) => {
  const { order_id } = req.params;
  const order = db.orders.get(order_id);
  if (!order) return res.json({ status: 'not_found' });

  // If still pending, check Selcom directly
  if (order.status === 'pending') {
    try {
      const r = await selcom.getFunc('/v1/checkout/order-status', { order_id });
      const d = r?.data?.[0] || {};
      const selcomStatus = d.payment_status || d.order_status || '';

      if (selcomStatus === 'COMPLETED' || r?.resultcode === '000') {
        order.status    = 'success';
        order.selcomRef = d.reference || order.selcomRef;
        db.orders.set(order_id, order);
        activateSubscription(order);
      } else if (['FAILED','CANCELLED','EXPIRED'].includes(selcomStatus)) {
        order.status = 'failed';
        db.orders.set(order_id, order);
      }
    } catch (e) {
      console.warn('Status query error (non-fatal):', e.message);
    }
  }

  res.json({ status: order.status, plan: order.plan, selcomRef: order.selcomRef });
});

// ─────────────────────────────────────────────────────────────────
// 4. CANCEL ORDER  →  POST /api/payment/cancel/:order_id
// ─────────────────────────────────────────────────────────────────
app.post('/api/payment/cancel/:order_id', async (req, res) => {
  const { order_id } = req.params;
  const order = db.orders.get(order_id);
  if (!order) return res.json({ success: false, message: 'Order not found' });

  try {
    await selcom.deleteFunc('/v1/checkout/cancel-order', { order_id });
    order.status = 'cancelled';
    db.orders.set(order_id, order);
    console.log(`🚫 Order cancelled: ${order_id}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 5. WALLET PUSH USSD  →  POST /api/payment/wallet-push
//    Alternative to gateway redirect — pushes USSD prompt directly to
//    the customer's phone (works for M-Pesa, Airtel, Tigo, Halo, TTCL).
//    Customer just enters their PIN on their phone; no browser redirect.
// ─────────────────────────────────────────────────────────────────
app.post('/api/payment/wallet-push', async (req, res) => {
  const { phone, name, company, email, plan, amount } = req.body;

  if (!phone || !name || !plan || !amount) {
    return res.status(400).json({ success: false, message: 'phone, name, plan and amount are required' });
  }

  const order_id       = genOrderId();
  const formattedPhone = formatPhone(phone);

  db.orders.set(order_id, {
    order_id, phone: formattedPhone, name,
    company: company || '', email: email || '',
    plan, amount, status: 'pending', selcomRef: null, createdAt: new Date(),
  });

  try {
    // Step 1: create checkout order
    const orderRes = await selcom.postFunc('/v1/checkout/create-order-minimal', {
      vendor:           process.env.SELCOM_VENDOR,
      order_id,
      buyer_email:      email || `${formattedPhone}@hireready.co.tz`,
      buyer_name:       name,
      buyer_phone:      formattedPhone,
      amount,
      currency:         'TZS',
      buyer_remarks:    `HireReady ${plan} subscription`,
      merchant_remarks: `Plan: ${plan}`,
      no_of_items:      1,
      webhook:          process.env.SELCOM_WEBHOOK_URL,
    });

    if (orderRes?.result !== 'SUCCESS') {
      return res.status(502).json({ success: false, message: orderRes?.message || 'Order creation failed' });
    }

    // Step 2: push USSD to phone
    const pushRes = await selcom.postFunc('/v1/wallet/pushussd', {
      transid:    order_id,
      utilityref: order_id,
      amount,
      vendor:     process.env.SELCOM_VENDOR,
      msisdn:     formattedPhone,
    });

    console.log(`📱 USSD push | ${order_id} | ${formattedPhone} | ${plan}`);

    res.json({
      success:  true,
      order_id,
      message:  pushRes?.message || `Payment prompt sent to +${formattedPhone}. Ask the customer to enter their wallet PIN.`,
    });

  } catch (err) {
    console.error('wallet-push error:', err.message);
    res.status(500).json({ success: false, message: 'Gateway error', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 6. CHECK SUBSCRIPTION  →  GET /api/subscription/:phone
// ─────────────────────────────────────────────────────────────────
app.get('/api/subscription/:phone', (req, res) => {
  const phone = formatPhone(req.params.phone);
  const sub   = db.subscriptions.get(phone);
  if (!sub) return res.json({ active: false, plan: 'starter' });
  const active = new Date() < new Date(sub.activeUntil);
  res.json({ active, plan: sub.plan, name: sub.name, company: sub.company, activeUntil: sub.activeUntil });
});

// ─────────────────────────────────────────────────────────────────
// 7. SUBMIT SCORE  →  POST /api/scores
// ─────────────────────────────────────────────────────────────────
app.post('/api/scores', (req, res) => {
  const { phone, name, company, category, difficulty, score, total, bestStreak, aiGenerated } = req.body;
  if (!name || score === undefined || !total) {
    return res.status(400).json({ error: 'name, score and total are required' });
  }
  db.scores.push({
    phone: phone || 'anonymous', name, company: company || '',
    category: category || 'General', difficulty: difficulty || 'easy',
    score: parseInt(score), total: parseInt(total),
    bestStreak: parseInt(bestStreak) || 0,
    aiGenerated: !!aiGenerated, createdAt: new Date(),
  });
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────
// 8. LEADERBOARD  →  GET /api/leaderboard
// ─────────────────────────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const { category, limit = 20, period } = req.query;
  let filtered = [...db.scores];
  if (category) filtered = filtered.filter(s => s.category.toLowerCase().includes(category.toLowerCase()));
  if (period === 'week') {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(s => new Date(s.createdAt) > weekAgo);
  }
  const best = new Map();
  filtered.forEach(s => { if (!best.get(s.name) || s.score > best.get(s.name).score) best.set(s.name, s); });
  res.json([...best.values()].sort((a,b) => b.score - a.score || b.bestStreak - a.bestStreak).slice(0, parseInt(limit)));
});

// ─────────────────────────────────────────────────────────────────
// 9. HEALTH CHECK  →  GET /api/health
// ─────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    env:    process.env.SELCOM_BASE_URL?.includes('test') ? 'sandbox' : 'production',
    orders: db.orders.size,
    subscriptions: db.subscriptions.size,
    scores: db.scores.length,
    uptime: `${Math.floor(process.uptime())}s`,
  });
});

// ─────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const env = process.env.SELCOM_BASE_URL?.includes('test') ? 'SANDBOX' : 'PRODUCTION';
  console.log(`\n🚀  HireReady  ·  port ${PORT}  ·  Selcom ${env}\n`);
  console.log(`   POST  /api/payment/create-order        Create Selcom checkout order`);
  console.log(`   POST  /api/payment/webhook             Selcom result callback`);
  console.log(`   GET   /api/payment/status/:order_id    Poll payment result`);
  console.log(`   POST  /api/payment/cancel/:order_id    Cancel pending order`);
  console.log(`   POST  /api/payment/wallet-push         Push USSD to phone directly`);
  console.log(`   GET   /api/subscription/:phone         Check active plan`);
  console.log(`   POST  /api/scores                      Submit quiz score`);
  console.log(`   GET   /api/leaderboard                 Top scores`);
  console.log(`   GET   /api/health                      Health\n`);
});