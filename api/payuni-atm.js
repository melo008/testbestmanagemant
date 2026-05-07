const crypto = require('crypto');
const https = require('https');

export default async function handler(req, res) {
  // 只抓取必要的環境變數
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;
  
  if (!PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ error: "環境變數 PAYUNI_HASH_KEY 或 IV 未設定" });
  }

  try {
    // 1. 準備加密參數 (直接取號模式)
    const encryptParams = {
      MerID: PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt: 100,
      Timestamp: Math.floor(Date.now() / 1000),
      BankType: "004", // 預設台銀
      ProdDesc: "ATM 直接取號測試",
      ExpireDate: "2026-12-31",
      NotifyURL: "https://test.com",
    };

    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    // AES-256-CBC 加密
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(JSON.stringify(encryptParams), 'utf8', 'hex') + cipher.final('hex');

    // SHA256 簽章
    const hashInfo = crypto.createHash('sha256')
      .update(PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV)
      .digest('hex').toUpperCase();

    const postData = `MerID=${PAYUNI_MER_ID}&Version=1.0&EncryptInfo=${encryptInfo}&HashInfo=${hashInfo}`;

    // 2. HTTPS 請求設定 (Hostname 必須是純域名)
    const options = {
      hostname: 'sandbox-api.payuni.com.tw', // ★ 這裡絕對沒有 ://
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

    // 3. 解密回傳資料拿帳號
    if (result.EncryptInfo) {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let dec = decipher.update(result.EncryptInfo, 'hex', 'utf8') + decipher.final('utf8');
      const decData = JSON.parse(dec);

      return res.status(200).json({
        success: true,
        payNo: decData.PayNo,      // 虛擬帳號
        bankCode: decData.BankCode, // 銀行代碼
        message: decData.Message
      });
    }

    return res.status(200).json({ success: false, payuniRaw: result });

  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      error: "連線失敗", 
      detail: err.message // 如果還是噴 ENOTFOUND，代表 Vercel 環境中有殘留的錯誤設定或舊代碼
    });
  }
}
