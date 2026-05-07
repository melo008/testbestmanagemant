const crypto = require('crypto');
const https = require('https');

export default async function handler(req, res) {
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;

  try {
    // 1. 準備加密參數
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt:   100,
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   "004", // 預設台銀
      ProdDesc:   "ATM 直接取號",
      ExpireDate: "2026-12-31",
      NotifyURL:  "https://test.com",
    };

    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    // 加密
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(JSON.stringify(encryptParams), 'utf8', 'hex') + cipher.final('hex');
    const hashInfo = crypto.createHash('sha256').update(PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV).digest('hex').toUpperCase();

    const postData = new URLSearchParams({
      MerID: PAYUNI_MER_ID,
      Version: "1.0",
      EncryptInfo: encryptInfo,
      HashInfo: hashInfo,
    }).toString();

    // 2. 使用 https.request 取代 fetch
    const options = {
      hostname: '://payuni.com.tw',
      path: '/api/atm',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const payuniResponse = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("PAYUNi 回傳格式錯誤")); }
        });
      });
      request.on('error', (err) => reject(err));
      request.write(postData);
      request.end();
    });

    // 3. 解密結果拿帳號
    if (payuniResponse.EncryptInfo) {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let dec = decipher.update(payuniResponse.EncryptInfo, 'hex', 'utf8') + decipher.final('utf8');
      const decryptedData = JSON.parse(dec);

      return res.status(200).json({
        success: true,
        status: decryptedData.Status,
        message: decryptedData.Message,
        // 這就是你要的直接取號結果
        payNo: decryptedData.PayNo, 
        bankCode: decryptedData.BankCode,
        expireDate: decryptedData.ExpireDate
      });
    }

    return res.status(200).json({ success: false, raw: payuniResponse });

  } catch (err) {
    return res.status(500).json({ success: false, error: "連線失敗", detail: err.message });
  }
}
