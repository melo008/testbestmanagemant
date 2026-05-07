const crypto = require('crypto');

export default async function handler(req, res) {
  const { PAYUNI_MER_ID, PAYUNI_HASH_KEY, PAYUNI_HASH_IV } = process.env;

  try {
    const encryptParams = {
      MerID:      PAYUNI_MER_ID,
      MerTradeNo: `T${Date.now()}`,
      TradeAmt:   100,
      Timestamp:  Math.floor(Date.now() / 1000),
      BankType:   "004", 
      ProdDesc:   "訂單測試",
      ExpireDate: "2026-12-31",
      NotifyURL:  "https://test.com",
    };

    const plainText = JSON.stringify(encryptParams);
    const key = Buffer.from(PAYUNI_HASH_KEY, 'utf8');
    const iv = Buffer.from(PAYUNI_HASH_IV, 'utf8');
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptInfo = cipher.update(plainText, 'utf8', 'hex') + cipher.final('hex');
    const hashInfo = crypto.createHash('sha256')
      .update(`HashKey=${PAYUNI_HASH_KEY}&EncryptInfo=${encryptInfo}&HashIV=${PAYUNI_HASH_IV}`)
      .digest('hex').toUpperCase();

    // 我直接把「收錢櫃檯」的完整網址寫在 action 裡面了
     const html = `
      <html>
      <head>
        <title>正在前往支付頁面</title>
        <meta charset="utf-8">
      </head>
      <body>
        <!-- 加了 [0] 確保 JS 一定抓得到這張表單 -->
        <form method="POST" action="https://payuni.com.tw">
          <input type="hidden" name="MerID" value="${PAYUNI_MER_ID}">
          <input type="hidden" name="Version" value="1.0">
          <input type="hidden" name="EncryptInfo" value="${encryptInfo}">
          <input type="hidden" name="HashInfo" value="${hashInfo}">
          <!-- 如果自動跳轉失敗，使用者還可以手動點按鈕 -->
          <noscript><button type="submit">點擊此處繼續付款</button></noscript>
        </form>
        
        <script>
          // 強制執行提交
          window.onload = function() {
            document.forms[0].submit();
          };
        </script>
        
        <p>正在前往 PAYUNi 測試付款頁面，請稍候...</p>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
