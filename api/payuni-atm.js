const crypto = require('crypto');
const https = require('https');

module.exports = async function handler(req, res) {
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;

  try {
    const { amount, merTradeNo } = req.body;

    // 1. 加密與簽章 (與之前相同)
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: merTradeNo || `TEST${Date.now()}`,
      TradeAmt: Math.round(Number(amount || 100)),
      Timestamp: Math.floor(Date.now() / 1000),
      BankType: "004",
      ProdDesc: "Sandbox Test",
      ExpireDate: "2026-12-31",
      NotifyURL: "https://vercel.app",
    };

    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex');
    encryptInfo += cipher.final('hex');

    const hashStr = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 2. 使用原生 HTTPS 模組發送 (取代 Fetch)
    const postData = new URLSearchParams({
      MerID: PAYUNI_MER_ID,
      Version: "1.0",
      EncryptInfo: encryptInfo,
      HashInfo: hashInfo
    }).toString();

    const options = {
      hostname: '://payuni.com.tw',
      path: '/api/upp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const payuniRequest = () => new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(JSON.parse(data)));
      });
      request.on('error', (err) => reject(err));
      request.write(postData);
      request.end();
    });

    const result = await payuniRequest();

    return res.status(200).json({ success: true, payuniResponse: result });

  } catch (err) {
    // 這裡會顯示具體的錯誤原因，例如是 Timeout 還是 Connection Refused
    return res.status(500).json({ error: "連線失敗", detail: err.message });
  }
};
