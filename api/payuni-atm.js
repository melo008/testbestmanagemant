const crypto = require('crypto');
const https = require('https');

export default async function handler(req, res) {
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;
  
  try {
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt: 100,
      Timestamp: Math.floor(Date.now() / 1000),
      BankType: "004",
      ProdDesc: "Test",
      ExpireDate: "2026-12-31",
      NotifyURL: "https://test.com",
    };

    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex') + cipher.final('hex');
    const hashInfo = crypto.createHash('sha256').update(`HashKey=${PAYUNI_HASH_KEY}&EncryptInfo=${encryptInfo}&HashIV=${PAYUNI_HASH_IV}`).digest('hex').toUpperCase();

    // 為了避免逾時，我們先「只回傳加密後的資料」
    // 你可以拿這串資料直接去打 PAYUNi 官網測試
    return res.status(200).json({
      readyToPost: true,
      apiUrl: "https://payuni.com.tw",
      data: {
        MerID: PAYUNI_MER_ID,
        Version: "1.0",
        EncryptInfo: encryptInfo,
        HashInfo: hashInfo
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
