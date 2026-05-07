const crypto = require('crypto');

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
