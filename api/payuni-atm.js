const crypto = require('crypto');
const https = require('https');

module.exports = async (req, res) => {
  // 直接從環境變數拿 Key，不准碰任何網址相關的變數
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;

  try {
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt: 100,
      Timestamp: Math.floor(Date.now() / 1000),
      BankType: "004",
      ProdDesc: "Direct ATM",
      ExpireDate: "2026-12-31",
      NotifyURL: "https://test.com"
    };

    const key = Buffer.from(PAYUNI_HASH_KEY.trim(), 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV.trim(), 'utf8');

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(JSON.stringify(encryptParams), 'utf8', 'hex') + cipher.final('hex');
    const hashInfo = crypto.createHash('sha256').update(PAYUNI_HASH_KEY.trim() + encryptInfo + PAYUNI_HASH_IV.trim()).digest('hex').toUpperCase();

    const postData = `MerID=${PAYUNI_MER_ID}&Version=1.0&EncryptInfo=${encryptInfo}&HashInfo=${hashInfo}`;

    const options = {
      hostname: 'sandbox-api.payuni.com.tw', // 直接寫死，不使用變數
      port: 443,
      path: '/api/atm',
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

    if (result.EncryptInfo) {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let dec = decipher.update(result.EncryptInfo, 'hex', 'utf8') + decipher.final('utf8');
      const decData = JSON.parse(dec);
      return res.status(200).json({ success: true, payNo: decData.PayNo, bankCode: decData.BankCode });
    }
    return res.status(200).json({ success: false, raw: result });

  } catch (err) {
    // 這裡會顯示到底是在哪裡出錯
    return res.status(500).json({ error: "連線失敗", detail: err.message });
  }
};
