// api/payuni-atm.js - CBC + JSON.stringify 格式
const crypto = require('crypto');

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
  return cipher.update(plainText, 'utf8', 'hex') + cipher.final('hex');
}

function aesDecrypt(encHex) {
  try {
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8');
  } catch(e) {
    console.error('Decrypt error:', e.message);
    return null;
  }
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

    // 用 JSON.stringify（跟你成功的版本一樣）
    const plainText   = JSON.stringify(encryptParams);
    const encryptInfo = aesEncrypt(plainText);
    const hashInfo    = sha256Hash(encryptInfo);

    console.log('Calling:', API_URL);
    console.log('PlainText:', plainText);

    const formBody = new URLSearchParams({
      MerID:       PAYUNI_MER_ID,
      Version:     '1.0',
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
        try { decryptedInfo = JSON.parse(dec); }
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
