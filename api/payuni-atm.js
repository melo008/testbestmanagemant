// api/payuni-atm.js - Base64 GCM 版本（符合 PAYUNi PHP SDK 格式）
const crypto = require('crypto');

const PAYUNI_MER_ID   = process.env.PAYUNI_MER_ID;
const PAYUNI_HASH_KEY = process.env.PAYUNI_HASH_KEY;
const PAYUNI_HASH_IV  = process.env.PAYUNI_HASH_IV;
const IS_SANDBOX      = process.env.PAYUNI_SANDBOX === 'true';

const API_URL = IS_SANDBOX
  ? 'https://sandbox-api.payuni.com.tw/api/atm'
  : 'https://api.payuni.com.tw/api/atm';

// AES-256-GCM 加密，輸出 Base64（與 PHP openssl_encrypt 相同）
function aesEncrypt(plainText) {
  const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
  const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // PHP 格式：ciphertext + tag，整個做 base64
  return Buffer.concat([enc, tag]).toString('base64');
}

// AES-256-GCM 解密（Base64 輸入）
function aesDecrypt(base64Data) {
  try {
    const buf = Buffer.from(base64Data, 'base64');
    const tagLen = 16;
    const encBuf = buf.slice(0, buf.length - tagLen);
    const tag    = buf.slice(buf.length - tagLen);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString('utf8');
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

    console.log('Calling:', API_URL);
    console.log('Params:', queryStr);
    console.log('EncryptInfo (base64, first 50):', encryptInfo.slice(0,50));

    const formBody = new URLSearchParams({
      MerID:       PAYUNI_MER_ID,
      Version:     '1.3',
      EncryptInfo: encryptInfo,
      HashInfo:    hashInfo,
    });

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'user-agent': 'payuni' },
      body: formBody.toString(),
    });

    const text = await response.text();
    console.log('PAYUNi response:', text);

    let result;
    try { result = JSON.parse(text); }
    catch(e) { return res.status(500).json({ error: 'Parse error', raw: text }); }

    let decryptedInfo = null;
    if (result.EncryptInfo) {
      const dec = aesDecrypt(result.EncryptInfo);
      if (dec) {
        try { decryptedInfo = Object.fromEntries(new URLSearchParams(dec)); }
        catch(e) { decryptedInfo = { raw: dec }; }
      }
      console.log('Decrypted:', decryptedInfo);
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
