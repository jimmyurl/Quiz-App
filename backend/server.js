require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ── In-memory DB (replace with real DB in production) ────────────
// Use SQLite or PostgreSQL for production. Schema suggestion:
//
// payments:  id, checkout_request_id, phone, plan, name, company, status, mpesa_code, created_at
// users:     id, phone, name, company, plan, active_until, created_at
// scores:    id, user_phone, category, difficulty, score, total, best_streak, ai_generated, created_at
//
const db = {
  payments: new Map(),  // checkoutRequestId → { phone, plan, name, company, status, mpesaCode }
  users: new Map(),     // phone → { plan, name, company, activeUntil }
  scores: [],           // [{ phone, name, company, category, score, total, bestStreak, createdAt }]
};

// ── 1. Get access token from Daraja ──────────────────────────────
async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const res = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return res.data.access_token;
}

// ── 2. Generate STK password ──────────────────────────────────────
function generatePassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
  return { password: Buffer.from(raw).toString('base64'), timestamp };
}

// ── 3. STK Push — sends PIN prompt to user's phone ───────────────
app.post('/api/mpesa/pay', async (req, res) => {
  const { phone, amount, plan, name, company } = req.body;

  if (!phone || !amount || !plan) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Format phone: 0712345678 or 712345678 → 255712345678
  const formattedPhone = '255' + phone.replace(/^(0|255)/, '');

  try {
    const token = await getAccessToken();
    const { password, timestamp } = generatePassword();

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: formattedPhone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: `HireReady-${plan}`,
        TransactionDesc: `HireReady ${plan} subscription`
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const checkoutRequestId = response.data.CheckoutRequestID;

    // Save pending payment
    db.payments.set(checkoutRequestId, {
      phone: formattedPhone,
      plan,
      name: name || '',
      company: company || '',
      status: 'pending',
      mpesaCode: null,
      amount,
      createdAt: new Date()
    });

    res.json({
      success: true,
      checkoutRequestId,
      message: 'Check your phone and enter your M-Pesa PIN'
    });

  } catch (error) {
    console.error('STK Push failed:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Payment initiation failed. Check Daraja credentials.' });
  }
});

// ── 4. Safaricom callback ─────────────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
  const { Body } = req.body;
  if (!Body?.stkCallback) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const { stkCallback } = Body;
  const resultCode = stkCallback.ResultCode;
  const checkoutRequestId = stkCallback.CheckoutRequestID;

  const payment = db.payments.get(checkoutRequestId);
  if (!payment) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  if (resultCode === 0) {
    const items = stkCallback.CallbackMetadata?.Item || [];
    const amount    = items.find(i => i.Name === 'Amount')?.Value;
    const mpesaCode = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    const phone     = items.find(i => i.Name === 'PhoneNumber')?.Value;

    payment.status = 'success';
    payment.mpesaCode = mpesaCode;
    db.payments.set(checkoutRequestId, payment);

    // Activate subscription — 30 days from now
    const activeUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    db.users.set(payment.phone, {
      plan: payment.plan,
      name: payment.name,
      company: payment.company,
      activeUntil,
    });

    console.log(`✅ Payment confirmed: ${mpesaCode} | TZS ${amount} | ${phone} | Plan: ${payment.plan}`);
  } else {
    payment.status = 'failed';
    db.payments.set(checkoutRequestId, payment);
    console.log(`❌ Payment failed. Code: ${resultCode} | ID: ${checkoutRequestId}`);
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ── 5. Poll payment status ────────────────────────────────────────
app.get('/api/mpesa/status/:checkoutRequestId', (req, res) => {
  const payment = db.payments.get(req.params.checkoutRequestId);
  if (!payment) return res.json({ status: 'not_found' });
  res.json({ status: payment.status, mpesaCode: payment.mpesaCode });
});

// ── 6. Check subscription status ─────────────────────────────────
app.get('/api/subscription/:phone', (req, res) => {
  const phone = '255' + req.params.phone.replace(/^(0|255)/, '');
  const user = db.users.get(phone);
  if (!user) return res.json({ active: false, plan: 'starter' });
  const active = new Date() < new Date(user.activeUntil);
  res.json({ active, plan: user.plan, name: user.name, company: user.company, activeUntil: user.activeUntil });
});

// ── 7. Submit score ───────────────────────────────────────────────
app.post('/api/scores', (req, res) => {
  const { phone, name, company, category, score, total, bestStreak, aiGenerated } = req.body;
  if (!name || score === undefined || !total) return res.status(400).json({ error: 'Missing fields' });

  db.scores.push({
    phone: phone || 'anonymous',
    name,
    company: company || '',
    category: category || 'General',
    score,
    total,
    bestStreak: bestStreak || 0,
    aiGenerated: !!aiGenerated,
    createdAt: new Date()
  });

  res.json({ success: true });
});

// ── 8. Get leaderboard ────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const { category, limit = 20 } = req.query;
  let scores = [...db.scores];
  if (category) scores = scores.filter(s => s.category.toLowerCase() === category.toLowerCase());

  // Best score per user (by name)
  const best = new Map();
  scores.forEach(s => {
    const existing = best.get(s.name);
    if (!existing || s.score > existing.score) best.set(s.name, s);
  });

  const leaderboard = [...best.values()]
    .sort((a, b) => b.score - a.score || b.bestStreak - a.bestStreak)
    .slice(0, parseInt(limit));

  res.json(leaderboard);
});

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', payments: db.payments.size, users: db.users.size, scores: db.scores.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 HireReady backend running on port ${PORT}`);
  console.log(`   POST /api/mpesa/pay       — Initiate M-Pesa STK push`);
  console.log(`   POST /api/mpesa/callback  — Safaricom callback`);
  console.log(`   GET  /api/mpesa/status/:id — Poll payment result`);
  console.log(`   GET  /api/subscription/:phone — Check active plan`);
  console.log(`   POST /api/scores          — Submit quiz score`);
  console.log(`   GET  /api/leaderboard     — Get top scores`);
});