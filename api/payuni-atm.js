// api/payuni-atm.js
import crypto from 'crypto';

const PAYUNI_MER_ID   = process.env.PAYUNI_MER_ID;
const PAYUNI_HASH_KEY = process.env.PAYUNI_HASH_KEY;
const PAYUNI_HASH_IV  = process.env.PAYUNI_HASH_IV;
const IS_SANDBOX      = process.env.PAYUNI_SANDBOX === 'true';

const API_URL = IS_SANDBOX
  ? 'https://sandbox-api.payuni.com.tw/api/atm'
  : 'https://api.payuni.com.tw/api/atm';

function aesEncrypt(plainText) {
  const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
  const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let enc = cipher.update(plainText, 'utf8', 'hex');
  enc += cipher.final('hex');
  return enc;
}

function aesDecrypt(encHex) {
  const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
  const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let dec = decipher.update(encHex, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function toQueryString(obj) {
  return Object.entries(obj).map(([k,v]) => `${k}=${v}`).join('&');
}

function sha256Hash(encryptInfo) {
  const str = `HashKey=${PAYUNI_HASH_KEY}&${encryptInfo}&HashIV=${PAYUNI_HASH_IV}`;
  return crypto.createHash('sha256').update(str).digest('hex').toUpperCase();
}

function getExpireDate() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  if (process.env.INTERNAL_API_KEY && apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const { roomId, roomName, amount, merTradeNo, bankType = '004' } = body;

  console.log('Request body:', JSON.stringify(body));

  if (!roomId || !amount || !merTradeNo) {
    return res.status(400).json({
      error: 'Missing required fields',
      received: { roomId, amount, merTradeNo }
    });
  }

  if (!PAYUNI_MER_ID || !PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ error: 'PAYUNi env vars not configured' });
  }

  try {
    const encryptParams = {
      MerID:       PAYUNI_MER_ID,
      MerTradeNo:  merTradeNo,
      TradeAmt:    Math.round(Number(amount)),
      Timestamp:   Math.floor(Date.now() / 1000),
      BankType:    bankType,
      ProdDesc:    `${roomName || roomId}`,
      ExpireDate:  getExpireDate(),
      NotifyURL:   process.env.PAYUNI_NOTIFY_URL || 'https://testbestmanagemant.vercel.app/api/payuni-webhook',
    };

    const queryStr    = toQueryString(encryptParams);
    const encryptInfo = aesEncrypt(queryStr);
    const hashInfo    = sha256Hash(encryptInfo);

    console.log('Calling:', API_URL);

    const formBody = new URLSearchParams({
      MerID:       PAYUNI_MER_ID,
      Version:     '1.3',
      EncryptInfo: encryptInfo,
      HashInfo:    hashInfo,
    });

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'user-agent': 'payuni',
      },
      body: formBody.toString(),
    });

    const text = await response.text();
    console.log('PAYUNi raw response:', text);

    let result;
    try { result = JSON.parse(text); }
    catch { return res.status(500).json({ error: 'PAYUNi parse error', raw: text }); }

    if (result.Status === 'SUCCESS' && result.EncryptInfo) {
      const dec    = aesDecrypt(result.EncryptInfo);
      const params = Object.fromEntries(new URLSearchParams(dec));
      console.log('Decrypted:', params);

      if (params.Status === 'SUCCESS' && params.PayNo) {
        return res.status(200).json({
          success:    true,
          payNo:      params.PayNo,
          bankType:   params.BankType,
          tradeNo:    params.TradeNo,
          expireDate: params.ExpireDate,
          merTradeNo: params.MerTradeNo,
        });
      }
      return res.status(500).json({ success: false, params });
    }

    return res.status(500).json({ success: false, status: result.Status, raw: result });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
