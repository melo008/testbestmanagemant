const crypto = require('crypto');
const https = require('https');

module.exports = async (req, res) => {
  // 自動去除環境變數可能存在的隱形空格
  const PAYUNI_MER_ID = (process.env.PAYUNI_MER_ID || "").trim();
  const PAYUNI_HASH_KEY = (process.env.PAYUNI_HASH_KEY || "").trim();
  const PAYUNI_HASH_IV = (process.env.PAYUNI_HASH_IV || "").trim();

  try {
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt: 100,
      Timestamp: Math.floor(Date.now() / 1000),
      BankType: "004",
      ProdDesc: "ATM Direct",
      ExpireDate: "2026-12-31",
      NotifyURL: "https://test.com"
    };

    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');

    // 1. 加密請求
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(JSON.stringify(encryptParams), 'utf8', 'hex') + cipher.final('hex');

    const hashInfo = crypto.createHash('sha256')
      .update(PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV)
      .digest('hex').toUpperCase();

    const postData = `MerID=${PAYUNI_MER_ID}&Version=1.0&EncryptInfo=${encryptInfo}&HashInfo=${hashInfo}`;

    // 2. 發送請求
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

    // 3. 解密回傳資料 (關鍵修復點)
    if (result.EncryptInfo) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        // 強制開啟 Padding 處理，解決 block length 錯誤
        decipher.setAutoPadding(true);
        
        let dec = decipher.update(result.EncryptInfo, 'hex', 'utf8');
        dec += decipher.final('utf8');
        
        const decData = JSON.parse(dec);
        return res.status(200).json({ 
          success: true, 
          payNo: decData.PayNo,      // ★ 這就是你要的帳號！
          bankCode: decData.BankCode, 
          message: decData.Message 
        });
      } catch (decErr) {
        return res.status(500).json({ 
          success: false, 
          error: "解密失敗，請檢查 Vercel 的 IV 是否剛好 16 位元", 
          detail: decErr.message,
          debug_iv_length: PAYUNI_HASH_IV.length
        });
      }
    }

    return res.status(200).json({ success: false, message: "取號失敗", raw: result });

  } catch (err) {
    return res.status(500).json({ error: "系統連線錯誤", detail: err.message });
  }
};
