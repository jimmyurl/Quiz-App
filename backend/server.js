require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// ── 1. Get access token from Daraja ──────────────────────────
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

// ── 2. Generate password (base64 of shortcode+passkey+timestamp) ──
function generatePassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
  return {
    password: Buffer.from(raw).toString('base64'),
    timestamp
  };
}

// ── 3. STK Push — sends PIN prompt to user's phone ───────────
app.post('/api/mpesa/pay', async (req, res) => {
  const { phone, amount, plan } = req.body;

  // Format phone: 0712345678 → 255712345678
  const formattedPhone = '255' + phone.replace(/^0/, '');

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
        AccountReference: `QuizArena-${plan}`,
        TransactionDesc: `Quiz Arena ${plan} subscription`
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Save CheckoutRequestID to DB to match the callback later
    // await db.savePendingPayment(response.data.CheckoutRequestID, phone, plan);

    res.json({
      success: true,
      checkoutRequestId: response.data.CheckoutRequestID,
      message: 'Check your phone and enter your M-Pesa PIN'
    });

  } catch (error) {
    console.error('STK Push failed:', error.response?.data);
    res.status(500).json({ success: false, message: 'Payment initiation failed' });
  }
});

// ── 4. Callback — Safaricom posts result here ─────────────────
app.post('/api/mpesa/callback', async (req, res) => {
  const { Body } = req.body;
  const { stkCallback } = Body;

  const resultCode = stkCallback.ResultCode;
  const checkoutRequestId = stkCallback.CheckoutRequestID;

  if (resultCode === 0) {
    // Payment SUCCESS
    const items = stkCallback.CallbackMetadata.Item;
    const amount    = items.find(i => i.Name === 'Amount')?.Value;
    const mpesaCode = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    const phone     = items.find(i => i.Name === 'PhoneNumber')?.Value;

    console.log(`Payment confirmed: ${mpesaCode} | TZS ${amount} | ${phone}`);

    // TODO: activate subscription in your database
    // await db.activateSubscription(checkoutRequestId, mpesaCode);

  } else {
    // Payment FAILED or CANCELLED
    console.log(`Payment failed. Code: ${resultCode} | ID: ${checkoutRequestId}`);
    // await db.markPaymentFailed(checkoutRequestId);
  }

  // Must respond 200 or Safaricom will keep retrying
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ── 5. Check payment status (frontend polls this) ─────────────
app.get('/api/mpesa/status/:checkoutRequestId', async (req, res) => {
  // Look up checkoutRequestId in your DB and return status
  // const status = await db.getPaymentStatus(req.params.checkoutRequestId);
  // res.json({ status }); // 'pending' | 'success' | 'failed'
  res.json({ status: 'pending' }); // placeholder
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});