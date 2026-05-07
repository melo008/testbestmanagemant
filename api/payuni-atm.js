const crypto = require('crypto');

export default async function handler(req, res) {
  // 取得 Vercel 後台設定的環境變數
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;

  if (!PAYUNI_HASH_KEY || !PAYUNI_HASH_IV) {
    return res.status(500).json({ error: "環境變數 PAYUNI_HASH_KEY 或 IV 未設定" });
  }

  try {
    // 1. 準備加密參數 (測試環境固定金額 100 元)
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt:   100,
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   "004", // ATM 測試
      ProdDesc:   "訂單測試",
      ExpireDate: "2026-12-31",
      NotifyURL:  "https://vercel.app",
    };

    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    // 2. AES-256-CBC 加密 (Hex 格式)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex');
    encryptInfo += cipher.final('hex');

    // 3. SHA256 簽章 (帶標籤格式)
    const hashStr = `HashKey=${PAYUNI_HASH_KEY}&EncryptInfo=${encryptInfo}&HashIV=${PAYUNI_HASH_IV}`;
    const hashInfo = crypto.createHash('sha256').update(hashStr).digest('hex').toUpperCase();

    // 4. 正確的 API 網址 (修正拼字與路徑)
    const apiUrl = "https://payuni.com.tw";
    
    // 建立自動提交表單
    const html = `
      <html>
      <head><title>正在前往支付頁面</title></head>
      <body onload="document.forms[0].submit()">
        <form method="POST" action="${apiUrl}">
          <input type="hidden" name="MerID" value="${PAYUNI_MER_ID}">
          <input type="hidden" name="Version" value="1.0">
          <input type="hidden" name="EncryptInfo" value="${encryptInfo}">
          <input type="hidden" name="HashInfo" value="${hashInfo}">
        </form>
        <p>正在前往 PAYUNi 測試付款頁面...</p>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);

  } catch (err) {
    return res.status(500).json({ error: "加密失敗", detail: err.message });
  }
}
