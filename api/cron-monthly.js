// api/cron-monthly.js
// 每月1號 台灣時間早上10:00（UTC 02:00）自動執行
// 幫每間房間取綠界虛擬帳號

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ── 綠界設定 ──
const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || '3002607';
const HASH_KEY    = process.env.ECPAY_HASH_KEY    || 'pwFHCqoQZGmho4w6';
const HASH_IV     = process.env.ECPAY_HASH_IV     || 'EkRm7iFT261dpevs';
const IS_SANDBOX  = process.env.ECPAY_SANDBOX !== 'false';
const ECPAY_URL   = IS_SANDBOX
  ? 'https://ecpayment-stage.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode'
  : 'https://ecpayment.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode';

// ── Supabase ──
const SUPA_URL = process.env.SUPABASE_URL || 'https://fuvfvfmprxnhwxkexmtr.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

function aesEncrypt(dataObj) {
  const key = Buffer.from(HASH_KEY, 'utf8');
  const iv  = Buffer.from(HASH_IV, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const urlEncoded = encodeURIComponent(JSON.stringify(dataObj));
  return Buffer.concat([cipher.update(urlEncoded, 'utf8'), cipher.final()]).toString('base64');
}

function aesDecrypt(base64Data) {
  try {
    const key = Buffer.from(HASH_KEY, 'utf8');
    const iv  = Buffer.from(HASH_IV, 'utf8');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const dec = Buffer.concat([
      decipher.update(Buffer.from(base64Data, 'base64')),
      decipher.final()
    ]).toString('utf8');
    return JSON.parse(decodeURIComponent(dec));
  } catch(e) { return null; }
}

function getMerchantTradeDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// 取綠界虛擬帳號
async function getEcpayAccount({ merTradeNo, amount, itemName, expireDays = 30 }) {
  const dataParams = {
    ATMInfo: { ATMBankCode: '007', ExpireDate: String(expireDays) },
    ChoosePayment: 'ATM',
    MerchantID: MERCHANT_ID,
    OrderInfo: {
      ItemName:          itemName.slice(0,400),
      MerchantTradeDate: getMerchantTradeDate(),
      MerchantTradeNo:   merTradeNo.replace(/[^a-zA-Z0-9]/g,'').slice(0,20),
      ReturnURL:         process.env.ECPAY_NOTIFY_URL || 'https://testbestmanagemant.vercel.app/api/ecpay-webhook',
      TotalAmount:       String(Math.round(Number(amount))),
      TradeDesc:         itemName.slice(0,200),
    }
  };

  const encryptedData = aesEncrypt(dataParams);
  const requestBody = {
    MerchantID: MERCHANT_ID,
    RqHeader:   { Timestamp: Math.floor(Date.now()/1000) },
    Data:       encryptedData,
  };

  const resp = await fetch(ECPAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const text = await resp.text();
  const result = JSON.parse(text);

  if (result.TransCode === 1 && result.Data) {
    const dec = aesDecrypt(result.Data);
    if (dec?.RtnCode === 1) {
      return {
        success:    true,
        vAccount:   dec.ATMInfo?.vAccount,
        bankCode:   dec.ATMInfo?.BankCode,
        expireDate: dec.ATMInfo?.ExpireDate,
        tradeNo:    dec.OrderInfo?.TradeNo,
      };
    }
    return { success: false, rtnCode: dec?.RtnCode, rtnMsg: dec?.RtnMsg };
  }
  return { success: false, transCode: result.TransCode, transMsg: result.TransMsg };
}

module.exports = async function handler(req, res) {
  // 驗證（Vercel Cron 或手動觸發）
  const auth = req.headers.authorization;
  const key  = req.headers['x-api-key'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient(SUPA_URL, SUPA_KEY);
  const now = new Date();
  const YM  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;

  const results = { success: [], failed: [], skipped: [] };

  try {
    // 讀取所有房間
    const { data: rooms, error } = await db
      .from('test_rooms')
      .select('id,name,addr,rent,elec,elec_type,elec_acc');

    if (error) throw error;
    console.log(`Cron: ${rooms.length} 間房間`);

    for (const room of rooms) {
      const shortId = room.id.slice(-6).replace(/[^a-zA-Z0-9]/g,'');

      // ── 取租金虛擬帳號 ──
      const rentTradeNo = `R${shortId}${YM}`;
      const rentAmount  = (room.rent || 0) + (room.elec_type === 'monthly' ? (room.elec || 0) : 0);

      await new Promise(r => setTimeout(r, 300)); // 避免太快

      const rentResult = await getEcpayAccount({
        merTradeNo: rentTradeNo,
        amount:     rentAmount || 100, // 最少 100 元
        itemName:   `${room.name || room.id}月租`,
        expireDays: 30,
      });

      if (rentResult.success) {
        const updateData = { acc: rentResult.vAccount };

        // ── 儲值電費：再取一個虛擬帳號 ──
        if (room.elec_type === 'prepay') {
          await new Promise(r => setTimeout(r, 300));
          const elecTradeNo = `E${shortId}${YM}`;
          const elecResult  = await getEcpayAccount({
            merTradeNo: elecTradeNo,
            amount:     1000, // 儲值電費固定金額，可調整
            itemName:   `${room.name || room.id}電費儲值`,
            expireDays: 30,
          });
          if (elecResult.success) {
            updateData.elec_acc = elecResult.vAccount;
            results.success.push({ roomId: room.id, name: room.name, rentAcc: rentResult.vAccount, elecAcc: elecResult.vAccount });
          } else {
            results.failed.push({ roomId: room.id, name: room.name, type: 'elec', error: elecResult.rtnMsg });
            results.success.push({ roomId: room.id, name: room.name, rentAcc: rentResult.vAccount });
          }
        } else {
          results.success.push({ roomId: room.id, name: room.name, rentAcc: rentResult.vAccount });
        }

        // 寫回 Supabase
        await db.from('test_rooms').update(updateData).eq('id', room.id);
      } else {
        results.failed.push({ roomId: room.id, name: room.name, type: 'rent', error: rentResult.rtnMsg || rentResult.transMsg });
      }
    }

    // 寫入 Log
    await db.from('test_audit_log').insert({
      user_id:   'cron',
      user_name: 'Vercel Cron',
      action:    '每月自動取號',
      target:    YM,
      detail:    `成功：${results.success.length} 間，失敗：${results.failed.length} 間`,
    });

    console.log('Cron 完成:', results);
    return res.status(200).json({
      monthKey: YM,
      summary:  { success: results.success.length, failed: results.failed.length },
      details:  results,
    });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
};
