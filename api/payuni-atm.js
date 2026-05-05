// api/payuni-atm.js
// PAYUNi 虛擬帳號取號 API
// 呼叫方式：POST /api/payuni-atm
// Body: { roomId, amount, merTradeNo, bankType }

const crypto = require('crypto');

// ── PAYUNi 設定（從環境變數讀取）──
const PAYUNI_MER_ID  = process.env.PAYUNI_MER_ID;   // 商店代號
const PAYUNI_HASH_KEY = process.env.PAYUNI_HASH_KEY; // Hash Key
const PAYUNI_HASH_IV  = process.env.PAYUNI_HASH_IV;  // IV Key
const PAYUNI_SANDBOX  = process.env.PAYUNI_SANDBOX === 'true'; // 沙箱模式

const API_URL = PAYUNI_SANDBOX
  ? 'https://sandbox-api.payuni.com.tw/api/atm'
  : 'https://api.payuni.com.tw/api/atm';

// ── AES-256-CBC 加密 ──
function aesEncrypt(data) {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(PAYUNI_HASH_KEY, 'utf8'),
    Buffer.from(PAYUNI_HASH_IV, 'utf8')
  );
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// ── SHA-256 Hash ──
function sha256Hash(data) {
  return crypto.createHash('sha256')
    .update(`HashKey=${PAYUNI_HASH_KEY}&${data}&HashIV=${PAYUNI_HASH_IV}`)
    .digest('hex')
    .toUpperCase();
}

// ── 將物件轉成 Query String ──
function toQueryString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

// ── AES 解密 ──
function aesDecrypt(encryptedHex) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(PAYUNI_HASH_KEY, 'utf8'),
    Buffer.from(PAYUNI_HASH_IV, 'utf8')
  );
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export default async function handler(req, res) {
  // 只允許 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 簡單的 API Key 保護（避免外部隨意呼叫）
  const authKey = req.headers['x-api-key'];
  console.log('auth received:', authKey);
  console.log('auth expected:', process.env.INTERNAL_API_KEY);
  if (!process.env.INTERNAL_API_KEY) {
    // 環境變數未設定時，暫時允許通過（測試用）
    console.warn('INTERNAL_API_KEY not set, allowing request');
  } else if (authKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized', received: authKey, hint: 'Check INTERNAL_API_KEY env var' });
  }

  const { roomId, roomName, amount, merTradeNo, bankType = '004' } = req.body;

  if (!roomId || !amount || !merTradeNo) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // ── 組建請求參數 ──
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: merTradeNo,           // 商店訂單編號（唯一）
      TradeAmt: Math.round(amount),     // 金額（整數）
      Timestamp: Math.floor(Date.now() / 1000), // Unix timestamp
      BankType: bankType,               // 004=玉山銀行（預設）
      ProdDesc: `${roomName || roomId}月租`,    // 商品說明
      ExpireDate: getExpireDate(),      // 截止日期（當月底）
      NotifyURL: process.env.PAYUNI_NOTIFY_URL || 
                 'https://testbestmanagemant.vercel.app/api/payuni-webhook',
    };

    const queryStr = toQueryString(encryptParams);
    const encryptInfo = aesEncrypt(queryStr);
    const hashInfo = sha256Hash(encryptInfo);

    // ── 呼叫 PAYUNi API ──
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'user-agent': 'payuni',
      },
      body: new URLSearchParams({
        MerID: PAYUNI_MER_ID,
        Version: '1.3',
        EncryptInfo: encryptInfo,
        HashInfo: hashInfo,
      }),
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'PAYUNi response parse error', raw: text });
    }

    // ── 解密回傳資料 ──
    if (result.Status === 'SUCCESS' && result.EncryptInfo) {
      const decrypted = aesDecrypt(result.EncryptInfo);
      const params = Object.fromEntries(new URLSearchParams(decrypted));

      if (params.Status === 'SUCCESS' && params.PayNo) {
        return res.status(200).json({
          success: true,
          payNo: params.PayNo,           // 虛擬帳號
          bankType: params.BankType,     // 銀行代碼
          tradeNo: params.TradeNo,       // PAYUNi 序號
          expireDate: params.ExpireDate, // 截止日期
          merTradeNo: params.MerTradeNo,
        });
      }
    }

    return res.status(500).json({
      success: false,
      status: result.Status,
      message: result.Message || 'Unknown error',
    });

  } catch (err) {
    console.error('PAYUNi ATM error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// 取得當月底日期
function getExpireDate() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const y = lastDay.getFullYear();
  const m = String(lastDay.getMonth() + 1).padStart(2, '0');
  const d = String(lastDay.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
