const crypto = require('crypto');

// 必須使用 /api/atm 才是後端直接取號的網址
const API_URL = "https://payuni.com.tw";

export default async function handler(req, res) {
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;

  try {
    // 1. 準備加密參數
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt:   100,
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   "004", // 004 為台灣銀行，可依手冊更換
      ProdDesc:   "直接取號測試",
      ExpireDate: "2026-12-31",
      NotifyURL:  "https://vercel.app",
    };

    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    // AES-256-CBC 加密
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex') + cipher.final('hex');

    // SHA256 簽章
    const hashStr = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 2. 向 PAYUNi 發送 POST 請求
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        MerID:       PAYUNI_MER_ID,
        Version:     "1.0",
        EncryptInfo: encryptInfo,
        HashInfo:    hashInfo,
      })
    });

    const result = await response.json();

    // 3. 解密 PAYUNi 回傳的結果
    if (result.EncryptInfo) {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let dec = decipher.update(result.EncryptInfo, 'hex', 'utf8') + decipher.final('utf8');
      const decryptedData = JSON.parse(dec);

      if (decryptedData.Status === 'SUCCESS') {
        // ★ 這裡就是你要的帳號資訊
        return res.status(200).json({
          success: true,
          bankCode: decryptedData.BankCode, // 銀行代碼
          payNo:    decryptedData.PayNo,    // 虛擬帳號 ★
          expire:   decryptedData.ExpireDate,
          amount:   decryptedData.TradeAmt
        });
      } else {
        return res.status(400).json({ success: false, message: decryptedData.Message });
      }
    }

    return res.status(500).json({ success: false, message: "取號失敗", raw: result });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
