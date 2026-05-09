// api/ecpay-webhook.js
// 綠界付款完成通知（幕後 Server POST）
// 租客匯款後綠界打這個網址，自動標記已付款

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.SUPABASE_URL || 'https://fuvfvfmprxnhwxkexmtr.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  let body = req.body || {};
  if (typeof body === 'string') {
    const params = new URLSearchParams(body);
    body = Object.fromEntries(params);
  }

  console.log('ECPay Webhook received:', JSON.stringify(body));

  // 綠界 Webhook 參數
  const {
    MerchantID,
    MerchantTradeNo,
    TradeNo,
    PaymentType,
    TradeAmt,
    PaymentDate,
    RtnCode,
    RtnMsg,
    BankCode,
    vAccount,
  } = body;

  // RtnCode = 1 代表付款成功
  if (String(RtnCode) !== '1') {
    console.log('Payment not successful, RtnCode:', RtnCode);
    return res.status(200).send('1|OK');
  }

  const db = createClient(SUPA_URL, SUPA_KEY);

  try {
    // MerTradeNo 格式：R{shortId}{YYYYMM} 或 E{shortId}{YYYYMM}
    const isElec    = MerchantTradeNo?.startsWith('E');
    const shortId   = MerchantTradeNo?.slice(1, 7);
    const monthStr  = MerchantTradeNo?.slice(7); // YYYYMM

    // 找對應房間（透過 acc 或 elec_acc 比對）
    const field = isElec ? 'elec_acc' : 'acc';
    const { data: rooms } = await db
      .from('test_rooms')
      .select('id,name,payments')
      .eq(field, vAccount);

    if (!rooms?.length) {
      console.log('Room not found for vAccount:', vAccount);
      return res.status(200).send('1|OK');
    }

    const room    = rooms[0];
    const now     = new Date();
    const monthKey = monthStr
      ? `${monthStr.slice(0,4)}-${monthStr.slice(4,6)}`
      : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    // 更新付款紀錄
    const payments = room.payments || {};
    if (!payments[monthKey]) payments[monthKey] = {};

    if (isElec) {
      payments[monthKey].elecStatus  = 'paid';
      payments[monthKey].elecPaidAt  = PaymentDate || new Date().toISOString();
      payments[monthKey].elecAmt     = TradeAmt;
      payments[monthKey].elecTradeNo = TradeNo;
    } else {
      payments[monthKey].status   = 'paid';
      payments[monthKey].paidAt   = PaymentDate || new Date().toISOString();
      payments[monthKey].method   = 'ecpay_atm';
      payments[monthKey].tradeNo  = TradeNo;
      payments[monthKey].bankCode = BankCode;
      payments[monthKey].vAccount = vAccount;
    }

    await db.from('test_rooms')
      .update({ payments })
      .eq('id', room.id);

    // 寫入 Log
    await db.from('test_audit_log').insert({
      user_id:   'ecpay_webhook',
      user_name: '綠界自動對帳',
      action:    isElec ? '電費自動標記已付款' : '租金自動標記已付款',
      target:    room.id,
      detail:    `${monthKey} 帳號：${vAccount} 金額：$${TradeAmt}`,
    });

    console.log(`Room ${room.id} (${room.name}) ${isElec ? '電費' : '租金'} 已付款 ${monthKey}`);

  } catch (err) {
    console.error('Webhook error:', err);
  }

  // 必須回傳 1|OK 給綠界
  return res.status(200).send('1|OK');
};
