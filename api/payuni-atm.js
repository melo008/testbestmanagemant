const crypto = require('crypto');
const https = require('https');

export default async function handler(req, res) {
  // 自動去除環境變數可能存在的空格
  const PAYUNI_MER_ID = (process.env.PAYUNI_MER_ID || "").trim();
  const PAYUNI_HASH_KEY = (process.env.PAYUNI_HASH_KEY || "").trim();
  const PAYUNI_HASH_IV = (process.env.PAYUNI_HASH_IV || "").trim();
  
  if (!PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ error: "Vercel 環境變數抓不到 Key 或 IV，請檢查設定" });
  }

  try {
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt: 100,
      Timestamp: Math.floor(Date.now() / 1000),
      BankType: "004", 
      ProdDesc: "ATM 取號測試",
      ExpireDate: "2026-12-31",
      NotifyURL: "https://test.com",
    };

    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    // 1. 加密
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(JSON.stringify(encryptParams), 'utf8', 'hex') + cipher.final('hex');

    // 2. 簽章
    const hashInfo = crypto.createHash('sha256')
      .update(PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV)
      .digest('hex').toUpperCase();

    const postData = `MerID=${PAYUNI_MER_ID}&Version=1.0&EncryptInfo=${encryptInfo}&HashInfo=${hashInfo}`;

    // 3. 發送請求
    const options = {
      hostname: '://payuni.com.tw',
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

    // 4. 解密 PAYUNi 回傳的虛擬帳號
    if (result.EncryptInfo) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(true);
        let dec = decipher.update(result.EncryptInfo, 'hex', 'utf8') + decipher.final('utf8');
        const decData = JSON.parse(dec);

        return res.status(200).json({
          success: true,
          status: decData.Status,
          message: decData.Message,
          payNo: decData.PayNo,      // ★ 這裡就是你要的轉帳帳號！
          bankCode: decData.BankCode,
          expireDate: decData.ExpireDate
        });
      } catch (decErr) {
        return res.status(500).json({ 
          success: false, 
          error: "解密失敗（Key/IV 可能與後台不符）", 
          detail: decErr.message,
          raw: result.EncryptInfo 
        });
      }
    }

    return res.status(200).json({ success: false, payuniMessage: result.Message, raw: result });

  } catch (err) {
    return res.status(500).json({ success: false, error: "系統連線錯誤", detail: err.message });
  }
}
