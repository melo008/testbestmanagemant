// api/ecpay-webhook.js
// 綠界付款完成通知
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.SUPABASE_URL || 'https://fuvfvfmprxnhwxkexmtr.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  let body = req.body || {};
  if (typeof body === 'string') {
    body = Object.fromEntries(new URLSearchParams(body));
  }

  console.log('ECPay Webhook received:', JSON.stringify(body));

  const { MerchantID, MerchantTradeNo, TradeNo, PaymentType,
          TradeAmt, PaymentDate, RtnCode, BankCode, vAccount } = body;

  // RtnCode = 1 代表付款成功
  if (String(RtnCode) !== '1') {
    console.log('Payment not successful, RtnCode:', RtnCode);
    return res.status(200).send('1|OK');
  }

  const db = createClient(SUPA_URL, SUPA_KEY);

  try {
    const isElec  = MerchantTradeNo?.startsWith('E');
    const field   = isElec ? 'elec_acc' : 'acc';

    // 用虛擬帳號找對應的房間
    console.log(`Searching ${field} = ${vAccount}`);
    const { data: rooms, error: roomErr } = await db
      .from('test_rooms')
      .select('id,name,addr')
      .eq(field, vAccount);

    console.log('Query result:', JSON.stringify(rooms), 'Error:', roomErr?.message);

    if (!rooms?.length) {
      console.log('Room not found for vAccount:', vAccount);
      // 嘗試用 ilike 搜尋（去除空格）
      const { data: rooms2 } = await db
        .from('test_rooms')
        .select('id,name,acc,elec_acc')
        .ilike(field, `%${vAccount.trim()}%`);
      console.log('Fuzzy search result:', JSON.stringify(rooms2));
      return res.status(200).send('1|OK');
    }

    const room = rooms[0];
    const now  = new Date();

    // 月份格式：YYYY-MM
    let monthStr = MerchantTradeNo?.slice(7, 13); // 從 MerTradeNo 取 YYYYMM
    const monthKey = monthStr?.length === 6
      ? `${monthStr.slice(0,4)}-${monthStr.slice(4,6)}`
      : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    console.log(`Room ${room.name} (${room.id}) ${isElec?'電費':'租金'} 付款 ${monthKey} vAccount:${vAccount}`);

    if (isElec) {
      // 電費付款：更新 test_payments 的 elec 欄位
      const { data: existing } = await db.from('test_payments')
        .select('*').eq('month_key', monthKey).eq('room_id', room.id).single();

      const updateData = {
        month_key: monthKey,
        room_id:   room.id,
        elec_status:   'paid',
        elec_paid_at:  PaymentDate || now.toISOString(),
        elec_trade_no: TradeNo,
        elec_amount:   Number(TradeAmt),
        updated_at:    now.toISOString(),
      };
      if (existing) {
        await db.from('test_payments').update(updateData)
          .eq('month_key', monthKey).eq('room_id', room.id);
      } else {
        await db.from('test_payments').insert({ ...updateData, status: 'unpaid' });
      }
    } else {
      // 租金付款：upsert test_payments
      const { data: existing } = await db.from('test_payments')
        .select('*').eq('month_key', monthKey).eq('room_id', room.id).single();

      const updateData = {
        month_key:  monthKey,
        room_id:    room.id,
        status:     'paid',
        paid_at:    PaymentDate || now.toISOString(),
        method:     'ecpay_atm',
        updated_at: now.toISOString(),
      };
      if (existing) {
        await db.from('test_payments').update(updateData)
          .eq('month_key', monthKey).eq('room_id', room.id);
      } else {
        await db.from('test_payments').insert(updateData);
      }
    }

    // 寫入操作 Log
    await db.from('test_audit_log').insert({
      user_id:   'ecpay_webhook',
      user_name: '綠界自動對帳',
      action:    isElec ? '電費自動標記已付款' : '租金自動標記已付款',
      target:    room.id,
      detail:    `${monthKey} 帳號：${vAccount} 金額：$${TradeAmt}`,
    });

    console.log(`✓ 已更新 ${room.name} ${monthKey} ${isElec?'電費':'租金'}付款`);

  } catch (err) {
    console.error('Webhook error:', err);
  }

  return res.status(200).send('1|OK');
};
