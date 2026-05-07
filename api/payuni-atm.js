    // 修正後的發送設定
    const postData = new URLSearchParams({
      MerID: PAYUNI_MER_ID,
      Version: "1.0",
      EncryptInfo: encryptInfo,
      HashInfo: hashInfo
    }).toString();

    const options = {
      // 注意：這裡只能放域名，不能有 https://，也不能有斜線 /
      hostname: 'sandbox-api.payuni.com.tw', 
      port: 443,
      path: '/api/upp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
