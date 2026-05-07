const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '請使用 POST' });

  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV, PAYUNI_SANDBOX } = process.env;

  try {
    const { amount, merTradeNo, bankType = '004' } = req.body;

    // 1. 準備加密參數
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: merTradeNo || `TEST${Date.now()}`, // 測試環境建議加個 TEST 字樣
      TradeAmt:   Math.round(Number(amount || 100)),
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   bankType,
      ProdDesc:   "Sandbox Test",
      ExpireDate: "2026-12-31", 
      NotifyURL:  "https://vercel.app",
    };

    // 2. AES-256-CBC 加密 (Hex 格式)
    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv  = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex');
    encryptInfo += cipher.final('hex');

    // 3. SHA256 簽章
    const hashStr = PAYUNI_HASH_KEY + encryptInfo + PAYUNI_HASH_IV;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 4. 正式打給 PAYUNi SANDBOX
    // 網址一定要有 sandbox 字樣
    const apiUrl = 'https://payuni.com.tw'; 

    const params = new URLSearchParams();
    params.append('MerID', PAYUNI_MER_ID);
    params.append('Version', '1.0');
    params.append('EncryptInfo', encryptInfo);
    params.append('HashInfo', hashInfo);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const result = await response.json();

    // 5. 回傳結果給 Postman
    return res.status(200).json({
      success: true,
      mode: "SANDBOX",
      payuniResponse: result
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
