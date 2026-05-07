const crypto = require('crypto');
const https = require('https');

module.exports = async function handler(req, res) {
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;
  
  if (!PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ error: "環境變數未設定" });
  }

  try {
    const { amount, merTradeNo } = req.body || {};

    // 1. 準備加密參數 (確保 TradeAmt 是整數)
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: merTradeNo || `T${Date.now()}`,
      TradeAmt: Math.round(Number(amount || 100)),
      Timestamp: Math.floor(Date.now() / 1000),
      BankType: "004",
      ProdDesc: "Payment Test",
      ExpireDate: "2026-12-31",
      NotifyURL: "https://vercel.app",
    };

    const plainText = JSON.stringify(encryptParams);
    
    // 2. AES-256-CBC 加密 (Hex 格式)
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex');
    encryptInfo += cipher.final('hex');

    // 3. ★ HashInfo 簽章 (採用選項 A：直接相加，不加 &)
    const hashStr = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 4. 發送請求
    const postData = new URLSearchParams({
      MerID: PAYUNI_MER_ID,
      Version: "1.0",
      EncryptInfo: encryptInfo,
      HashInfo: hashInfo
    }).toString();

    const options = {
      hostname: '://payuni.com.tw',
      port: 443,
      path: '/api/upp',
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
        response.on('end', () => resolve(data)); // UPP 回傳 HTML，所以不跑 JSON.parse
      });
      request.on('error', (err) => reject(err));
      request.write(postData);
      request.end();
    });

    // 5. 輸出結果
    return res.status(200).json({ 
      success: true, 
      payuniResponse: result 
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
