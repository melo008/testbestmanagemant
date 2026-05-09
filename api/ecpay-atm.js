// api/ecpay-atm.js - 綠界虛擬帳號幕後取號
const crypto = require('crypto');

// 測試環境金鑰（正式上線時換成環境變數）
const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || '3002607';
const HASH_KEY    = process.env.ECPAY_HASH_KEY    || 'pwFHCqoQZGmho4w6';
const HASH_IV     = process.env.ECPAY_HASH_IV     || 'EkRm7iFT261dpevs';
const IS_SANDBOX  = process.env.ECPAY_SANDBOX !== 'false';

const API_URL = IS_SANDBOX
  ? 'https://ecpayment-stage.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode'
  : 'https://ecpayment.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode';

// AES-128-CBC 加密：URLEncode → AES → Base64
function aesEncrypt(data) {
  const key = Buffer.from(HASH_KEY, 'utf8');
  const iv  = Buffer.from(HASH_IV, 'utf8');
  // 先 URLEncode
  const urlEncoded = encodeURIComponent(JSON.stringify(data));
  // AES-128-CBC 加密，輸出 Base64
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(true);
  const enc = Buffer.concat([cipher.update(urlEncoded, 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

// AES-128-CBC 解密
function aesDecrypt(base64Data) {
  try {
    const key = Buffer.from(HASH_KEY, 'utf8');
    const iv  = Buffer.from(HASH_IV, 'utf8');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const dec = Buffer.concat([
      decipher.update(Buffer.from(base64Data, 'base64')),
      decipher.final()
    ]).toString('utf8');
    // URLDecode 後解析 JSON
    return JSON.parse(decodeURIComponent(dec));
  } catch(e) {
    console.error('Decrypt error:', e.message);
    return null;
  }
}

function getMerchantTradeDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const apiKey = req.headers['x-api-key'];
  if (process.env.INTERNAL_API_KEY && apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const { roomId, roomName, amount, merTradeNo, bankCode = '', expireDays = 7 } = body;

  if (!roomId || !amount || !merTradeNo) {
    return res.status(400).json({ error: 'Missing required fields', received: { roomId, amount, merTradeNo } });
  }

  try {
    // 組建加密前的 Data 物件
    const dataParams = {
      MerchantID:    MERCHANT_ID,
      ChoosePayment: 'ATM',
      OrderInfo: {
        MerchantTradeNo:   merTradeNo.slice(0, 20), // 最多20字元
        MerchantTradeDate: getMerchantTradeDate(),
        TotalAmount:       Math.round(Number(amount)),
        ReturnURL:         process.env.ECPAY_NOTIFY_URL || 'https://testbestmanagemant.vercel.app/api/ecpay-webhook',
        TradeDesc:         encodeURIComponent(roomName || roomId),
        ItemName:          encodeURIComponent(`${roomName || roomId}月租`),
      },
      ATMInfo: {
        ExpireDate:  expireDays,  // 幾天內有效
        ATMBankCode: bankCode,    // 空字串=綠界預設銀行
      }
    };

    const encryptedData = aesEncrypt(dataParams);
    const timestamp     = Math.floor(Date.now() / 1000);

    const requestBody = {
      MerchantID: MERCHANT_ID,
      RqHeader:   { Timestamp: timestamp },
      Data:       encryptedData,
    };

    console.log('Calling ECPay:', API_URL);
    console.log('Data params:', JSON.stringify(dataParams));

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();
    console.log('ECPay raw response:', text);

    let result;
    try { result = JSON.parse(text); }
    catch(e) { return res.status(500).json({ error: 'Parse error', raw: text }); }

    // 解密 Data
    let decrypted = null;
    if (result.Data) {
      decrypted = aesDecrypt(result.Data);
      console.log('Decrypted:', JSON.stringify(decrypted));
    }

    // 成功：RtnCode === 1
    if (result.TransCode === 1 && decrypted?.RtnCode === 1) {
      return res.status(200).json({
        success:     true,
        vAccount:    decrypted.ATMInfo?.vAccount,    // 虛擬帳號
        bankCode:    decrypted.ATMInfo?.BankCode,    // 銀行代碼
        expireDate:  decrypted.ATMInfo?.ExpireDate,  // 到期日
        tradeNo:     decrypted.OrderInfo?.TradeNo,   // 綠界交易編號
        merTradeNo:  decrypted.OrderInfo?.MerchantTradeNo,
        amount:      decrypted.OrderInfo?.TradeAmt,
      });
    }

    return res.status(500).json({
      success:     false,
      transCode:   result.TransCode,
      transMsg:    result.TransMsg,
      rtnCode:     decrypted?.RtnCode,
      rtnMsg:      decrypted?.RtnMsg,
      decrypted,
    });

  } catch (err) {
    console.error('ECPay error:', err);
    return res.status(500).json({ error: err.message });
  }
};
