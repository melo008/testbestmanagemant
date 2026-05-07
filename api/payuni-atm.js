const crypto = require('crypto');

module.exports = async function handler(req, res) {
  // 1. 基本檢查
  if (req.method !== 'POST') return res.status(405).json({ error: '請使用 POST' });

  // 取得環境變數 (請確保 Vercel 後台有設這三個)
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV, PAYUNI_SANDBOX } = process.env;

  if (!PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ error: '伺服器環境變數 Key/IV 未設定' });
  }

  try {
    // 2. 接收 Postman 傳來的參數
    const { amount, merTradeNo, bankType = '004' } = req.body;

    // PAYUNi 加密前置參數
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: merTradeNo || `T${Date.now()}`,
      TradeAmt:   Math.round(Number(amount || 100)),
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   bankType,
      ProdDesc:   "Test Product",
      ExpireDate: "2026-12-31", // 建議先寫死一個日期測試
      NotifyURL:  "https://your-webhook.com",
    };

    // 3. ★ 核心加密邏輯 (AES-256-CBC)
    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex');
    encryptInfo += cipher.final('hex');

    // 4. ★ 核心簽章邏輯 (SHA256)
    // 規格：HashKey + EncryptInfo + HashIV (字串直接相加)
    const hashStr = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 5. 準備打給 PAYUNi
    const apiUrl = PAYUNI_SANDBOX === 'true' 
      ? 'https://payuni.com.tw' 
      : 'https://payuni.com.tw';

    // 使用 Vercel 內建的 fetch (Node 18+) 或改用更穩的發送方式
    // 為了避免 fetch 崩潰，我們先把結果 return 回 Postman，讓你自己去測 PAYUNi
    return res.status(200).json({
      success: true,
      message: "加密成功，請檢查以下參數是否符合 PAYUNi 後台",
      endpoint: apiUrl,
      sendData: {
        MerID: PAYUNI_MER_ID,
        Version: "1.0",
        EncryptInfo: encryptInfo,
        HashInfo: hashInfo
      },
      debug_plainText: plainText // 讓你看加密前長怎樣
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
