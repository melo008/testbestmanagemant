// api/payuni-atm.js
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PAYUNI_MER_ID   = process.env.PAYUNI_MER_ID;
const PAYUNI_HASH_KEY = process.env.PAYUNI_HASH_KEY;
const PAYUNI_HASH_IV  = process.env.PAYUNI_HASH_IV;
const IS_SANDBOX      = process.env.PAYUNI_SANDBOX === 'true';
const FIXIE_URL       = process.env.FIXIE_URL; // 固定 IP proxy

const API_URL = IS_SANDBOX
  ? 'https://sandbox-api.payuni.com.tw/api/atm'
  : 'https://api.payuni.com.tw/api/atm';

// AES-256-GCM 加密
function aesEncrypt(plainText) {
  const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
  const iv  = Buffer.from(PAYUNI_HASH_IV,  'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plainText, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return enc + ':::' + tag.toString('base64');
}

// AES-256-GCM 解密
function aesDecrypt(encData) {
  try {
    const [encHex, tagB64] = encData.split(':::');
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV,  'utf8');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    if (tagB64) decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch(e) {
    console.error('Decrypt error:', e.message);
    return null;
  }
}

function toQueryString(obj) {
  return Object.entries(obj).map(([k,v]) => `${k}=${v}`).join('&');
}

function sha256Hash(encryptInfo) {
  const str = `HashKey=${PAYUNI_HASH_KEY}&EncryptInfo=${encryptInfo}&HashIV=${PAYUNI_HASH_IV}`;
  return crypto.createHash('sha256').update(str).digest('hex').toUpperCase();
}

function getExpireDate() {
  const now  = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  if (process.env.INTERNAL_API_KEY && apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const { roomId, roomName, amount, merTradeNo, bankType = '004' } = body;

  if (!roomId || !amount || !merTradeNo) {
    return res.status(400).json({ error: 'Missing required fields', received: { roomId, amount, merTradeNo } });
  }

  if (!PAYUNI_MER_ID || !PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ error: 'PAYUNi env vars not configured' });
  }

  try {
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: merTradeNo,
      TradeAmt:   Math.round(Number(amount)),
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   bankType,
      ProdDesc:   (roomName || roomId).replace(/[^\w\s]/g, ''),
      ExpireDate: getExpireDate(),
      NotifyURL:  process.env.PAYUNI_NOTIFY_URL || 'https://testbestmanagemant.vercel.app/api/payuni-webhook',
    };

    const queryStr    = toQueryString(encryptParams);
    const encryptInfo = aesEncrypt(queryStr);
    const hashInfo    = sha256Hash(encryptInfo);

    console.log('Params:', queryStr);
    console.log('API URL:', API_URL);
    console.log('Using proxy:', FIXIE_URL ? 'YES' : 'NO');

    const formBody = new URLSearchParams({
      MerID:       PAYUNI_MER_ID,
      Version:     '1.3',
      EncryptInfo: encryptInfo,
      HashInfo:    hashInfo,
    });

    // 如果有 FIXIE_URL 就走固定 IP proxy
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'user-agent': 'payuni',
      },
      body: formBody.toString(),
    };
    if (FIXIE_URL) {
      fetchOptions.agent = new HttpsProxyAgent(FIXIE_URL);
    }

    const response = await fetch(API_URL, fetchOptions);
    const text = await response.text();
    console.log('PAYUNi response:', text);

    let result;
    try { result = JSON.parse(text); } catch(e) { return res.status(500).json({ error: 'Parse error', raw: text }); }

    let decryptedInfo = null;
    if (result.EncryptInfo) {
      const dec = aesDecrypt(result.EncryptInfo);
      if (dec) decryptedInfo = Object.fromEntries(new URLSearchParams(dec));
    }

    if (result.Status === 'SUCCESS' && decryptedInfo?.Status === 'SUCCESS' && decryptedInfo?.PayNo) {
      return res.status(200).json({
        success:    true,
        payNo:      decryptedInfo.PayNo,
        bankType:   decryptedInfo.BankType,
        tradeNo:    decryptedInfo.TradeNo,
        expireDate: decryptedInfo.ExpireDate,
        merTradeNo: decryptedInfo.MerTradeNo,
      });
    }

    return res.status(500).json({
      success:      false,
      outerStatus:  result.Status,
      innerStatus:  decryptedInfo?.Status,
      innerMessage: decryptedInfo?.Message,
      decrypted:    decryptedInfo,
      params:       encryptParams,
    });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
