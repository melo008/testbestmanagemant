// 3. SHA256 簽章 (嘗試直接相加)
const hashStr = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();


module.exports = async function handler(req, res) {
  // 檢查環境變數是否存在
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;
  
  if (!PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ success: false, error: "Vercel 環境變數未設定完全" });
  }

  try {
    const { amount, merTradeNo } = req.body || {};

    // 1. 加密參數
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
    
    // 2. AES-256-CBC 加密
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex');
    encryptInfo += cipher.final('hex');

    // 3. SHA256 簽章
    const hashStr = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 4. 發送請求 - 這裡我已經把 hostname 改成純域名，絕對沒有 ://
    const postData = new URLSearchParams({
      MerID: PAYUNI_MER_ID,
      Version: "1.0",
      EncryptInfo: encryptInfo,
      HashInfo: hashInfo
    }).toString();

    const options = {
      hostname: 'sandbox-api.payuni.com.tw', // ★ 檢查這裡，絕對不能有 https://
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
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
        });
      });
      request.on('error', (err) => {
        // 如果連線失敗，回傳詳細錯誤
        reject(err);
      });
      request.write(postData);
      request.end();
    });

    return res.status(200).json({ 
      success: true, 
      status: "連線成功",
      payuniResponse: result 
    });

  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      error: "連線發生錯誤",
      detail: err.message // 檢查這裡是否還有 ENOTFOUND
    });
  }
};
