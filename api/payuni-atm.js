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
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(PAYUNI_HASH_KEY), Buffer.from(PAYUNI_HASH_IV));
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex') + cipher.final('hex');
    const hashInfo = crypto.createHash('sha256').update(PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV).digest('hex').toUpperCase();

    const postData = `MerID=${PAYUNI_MER_ID}&Version=1.0&EncryptInfo=${encryptInfo}&HashInfo=${hashInfo}`;

    const options = {
      hostname: 'sandbox-api.payuni.com.tw', // ★ 這裡絕對沒有冒號斜線
      path: '/api/upp',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    };

    const result = await new Promise((resolve) => {
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(data));
      });
      request.write(postData);
      request.end();
    });

    return res.status(200).send(result); // 直接噴出 HTML
  } catch (err) {
    return res.status(500).json({ error: "還是噴錯", detail: err.message });
  }
}
