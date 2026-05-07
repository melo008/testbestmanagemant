const crypto = require('crypto');

// ...前面的設定...

module.exports = async function handler(req, res) {
  // ★ 就是放這裡！放在最前面，後面的程式碼就不會被執行到，直接回傳結果。
  return res.status(200).json({ message: "API 活著" });

  // 以下原本的程式碼會被暫時跳過
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // ...


// 修正後的 AES-256-CBC 加密
function aesEncrypt(plainText) {
  // 注意：PAYUNi 的 Key 和 IV 通常就是字串，直接轉 Buffer
  const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
  const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  // 1. 修改：輸入改為 JSON 字串
  // 2. 修改：加密結果轉為 hex (十六進位)，這是 PAYUNi 的標準格式
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return encrypted;
}

// 修正後的 SHA256 簽章
function sha256Hash(encryptInfo) {
  // PAYUNi 規格：HashKey + EncryptInfo + HashIV (不含等於符號)
  // 注意：有些版本中間不用 & 接，請參考手冊。標準公式通常如下：
  const str = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
  return crypto.createHash('sha256').update(str).digest('hex').toUpperCase();
}

// 在 handler 內的呼叫方式
const encryptParams = {
  MerID:      PAYUNI_MER_ID,
  MerTradeNo: merTradeNo,
  TradeAmt:   Math.round(Number(amount)),
  Timestamp:  Math.floor(Date.now() / 1000),
  // ... 其他參數
};

// 修正：加密 JSON 而不是 QueryString
const encryptInfo = aesEncrypt(JSON.stringify(encryptParams));
const hashInfo    = sha256Hash(encryptInfo);
