const crypto = require('crypto');
const https = require('https'); // 引入 https 模組來發送請求

export default async function handler(req, res) {
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;

  try {
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt:   100,
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   "004", 
      ProdDesc:   "直接取號測試",
      ExpireDate: "2026-12-31",
      NotifyURL:  "https://test.com",
    };

    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    // 1. 加密與簽章 (保持你原本的邏輯)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex') + cipher.final('hex');
    
    const hashStr = `HashKey=${PAYUNI_HASH_KEY}&EncryptInfo=${encryptInfo}&HashIV=${PAYUNI_HASH_IV}`;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 2. 準備由伺服器發送請求，不產生 HTML
    const postData = `MerID=${PAYUNI_MER_ID}&Version=1.0&EncryptInfo=${encryptInfo}&HashInfo=${hashInfo}`;
    
    const options = {
      hostname: '://payuni.com.tw',
      path: '/api/atm', // 直接取號專用路徑
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const result = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
        });
      });
      request.on('error', (err) => reject(err));
      request.write(postData);
      request.end();
    });

    // 3. 接收回應後解密，抓出 PayNo (虛擬帳號)
    if (result.EncryptInfo) {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let dec = decipher.update(result.EncryptInfo, 'hex', 'utf8') + decipher.final('utf8');
      const decData = JSON.parse(dec);

      return res.status(200).json({
        success: true,
        payNo:    decData.PayNo,      // ★ 這就是你要的帳號！
        bankCode: decData.BankCode,
        message:  decData.Message
      });
    }

    return res.status(200).json({ success: false, raw: result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
