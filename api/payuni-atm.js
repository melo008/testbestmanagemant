const crypto = require('crypto');
const https = require('https');

export default async function handler(req, res) {
  // 建議你在 Vercel 環境變數中重新貼上截圖裡的 Key，確保沒有空格
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;
  
  try {
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt:   100, // 必須是整數
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   "004",
      ProdDesc:   "Test Payment",
      ExpireDate: "2026-12-31",
      NotifyURL:  "https://test.com",
    };

    const plainText = JSON.stringify(encryptParams);
    
    // 1. AES-256-CBC 加密
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex');
    encryptInfo += cipher.final('hex');

    // 2. ★ 這是最重要的一行：PAYUNi 標準 SHA256 格式
    const hashStr = `HashKey=${PAYUNI_HASH_KEY}&EncryptInfo=${encryptInfo}&HashIV=${PAYUNI_HASH_IV}`;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 3. 準備發送表單
    const postData = new URLSearchParams({
      MerID:       PAYUNI_MER_ID,
      Version:     "1.0",
      EncryptInfo: encryptInfo,
      HashInfo:    hashInfo
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

    const result = await new Promise((resolve) => {
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(data));
      });
      request.write(postData);
      request.end();
    });

    // 直接回傳 HTML 給 Postman 預覽
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(result);

  } catch (err) {
    return res.status(500).json({ error: "加密或連線失敗", detail: err.message });
  }
}
