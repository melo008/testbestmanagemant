// api/ecpay-atm-addr.js - 針對單一地址取號
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.SUPABASE_URL || 'https://fuvfvfmprxnhwxkexmtr.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const IS_SANDBOX = process.env.ECPAY_SANDBOX !== 'false';
const ECPAY_URL = IS_SANDBOX
  ? 'https://ecpayment-stage.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode'
  : 'https://ecpayment.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode';

function getMerchantTradeDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function getEcpayAccount({ merTradeNo, amount, itemName, expireDays=30, merchantId, hashKey, hashIv }) {
  function encryptLocal(dataObj) {
    const key = Buffer.from(hashKey, 'utf8');
    const iv  = Buffer.from(hashIv, 'utf8');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const urlEncoded = encodeURIComponent(JSON.stringify(dataObj));
    return Buffer.concat([cipher.update(urlEncoded, 'utf8'), cipher.final()]).toString('base64');
  }

  function decryptLocal(base64Data) {
    try {
      const key = Buffer.from(hashKey, 'utf8');
      const iv  = Buffer.from(hashIv, 'utf8');
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      const dec = Buffer.concat([
        decipher.update(Buffer.from(base64Data, 'base64')),
        decipher.final()
      ]).toString('utf8');
      return JSON.parse(decodeURIComponent(dec));
    } catch(e) { return null; }
  }

  const dataParams = {
    ATMInfo: { ATMBankCode: '007', ExpireDate: String(expireDays) },
    ChoosePayment: 'ATM',
    MerchantID: merchantId,
    OrderInfo: {
      ItemName:          itemName.slice(0,400),
      MerchantTradeDate: getMerchantTradeDate(),
      MerchantTradeNo:   merTradeNo.replace(/[^a-zA-Z0-9]/g,'').slice(0,20),
      ReturnURL:         process.env.ECPAY_NOTIFY_URL || 'https://testbestmanagemant.vercel.app/api/ecpay-webhook',
      TotalAmount:       String(Math.round(Number(amount))),
      TradeDesc:         itemName.slice(0,200),
    }
  };

  const encryptedData = encryptLocal(dataParams);
  const resp = await fetch(ECPAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      MerchantID: merchantId,
      RqHeader:   { Timestamp: Math.floor(Date.now()/1000) },
      Data:       encryptedData,
    }),
  });

  const result = JSON.parse(await resp.text());
  if (result.TransCode === 1 && result.Data) {
    const dec = decryptLocal(result.Data);
    if (dec?.RtnCode === 1) {
      return { success: true, vAccount: dec.ATMInfo?.vAccount, bankCode: dec.ATMInfo?.BankCode };
    }
    return { success: false, error: dec?.RtnMsg || 'RtnCode ' + dec?.RtnCode };
  }
  return { success: false, error: result.TransMsg || 'TransCode ' + result.TransCode };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const { addrName } = body;
  if (!addrName) return res.status(400).json({ error: 'Missing addrName' });

  const db = createClient(SUPA_URL, SUPA_KEY);
  const now = new Date();
  const YM  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;

  // 讀取地址資訊
  const { data: addr } = await db.from('test_addresses')
    .select('name,pay_type,org_id').eq('name', addrName).single();

  if (!addr || addr.pay_type !== 'ecpay') {
    return res.status(400).json({ error: '此地址收款方式不是綠界' });
  }

  // 讀取組織金鑰
  const { data: org } = await db.from('test_organizations')
    .select('ecpay_merchant_id,ecpay_hash_key,ecpay_hash_iv')
    .eq('id', addr.org_id).single();

  if (!org?.ecpay_merchant_id || !org?.ecpay_hash_key || !org?.ecpay_hash_iv) {
    return res.status(400).json({ error: '此地址的組織沒有設定綠界金鑰' });
  }

  // 讀取此地址的所有房間
  const { data: rooms } = await db.from('test_rooms')
    .select('id,name,rent,elec,elec_type').eq('addr', addrName);

  if (!rooms?.length) return res.status(400).json({ error: '此地址沒有房間' });

  let successCount = 0, failedCount = 0;
  const failedRooms = [];

  for (const room of rooms) {
    const shortId = room.id.slice(-6).replace(/[^a-zA-Z0-9]/g,'');
    const ts = String(Date.now()).slice(-4);
    const rentAmount = (room.rent || 0) + (room.elec_type === 'monthly' ? (room.elec || 0) : 0);

    await new Promise(r => setTimeout(r, 300));

    const result = await getEcpayAccount({
      merTradeNo: `R${shortId}${YM}${ts}`,
      amount:     rentAmount || 100,
      itemName:   `${room.name}月租`,
      expireDays: 30,
      merchantId: org.ecpay_merchant_id,
      hashKey:    org.ecpay_hash_key,
      hashIv:     org.ecpay_hash_iv,
    });

    if (result.success) {
      const updateData = { acc: result.vAccount };

      // 儲值電費也取號
      if (room.elec_type === 'prepay') {
        await new Promise(r => setTimeout(r, 300));
        const elecResult = await getEcpayAccount({
          merTradeNo: `E${shortId}${YM}${ts}`,
          amount:     1000,
          itemName:   `${room.name}電費儲值`,
          expireDays: 30,
          merchantId: org.ecpay_merchant_id,
          hashKey:    org.ecpay_hash_key,
          hashIv:     org.ecpay_hash_iv,
        });
        if (elecResult.success) updateData.elec_acc = elecResult.vAccount;
      }

      await db.from('test_rooms').update(updateData).eq('id', room.id);

      // 寫入 Log
      await db.from('test_audit_log').insert({
        user_id: 'manual_getacc',
        user_name: '手動取號',
        action: '手動取虛擬帳號',
        target: room.id,
        detail: `地址：${addrName} 房間：${room.name} 帳號：${result.vAccount}`,
      });

      successCount++;
    } else {
      failedCount++;
      failedRooms.push({ name: room.name, error: result.error });

      // 失敗也寫入 Log
      await db.from('test_audit_log').insert({
        user_id: 'manual_getacc',
        user_name: '手動取號',
        action: '取虛擬帳號失敗',
        target: room.id,
        detail: `地址：${addrName} 房間：${room.name} 錯誤：${result.error}`,
      });
    }
  }

  return res.status(200).json({
    success: successCount,
    failed:  failedCount,
    failedRooms,
  });
};
