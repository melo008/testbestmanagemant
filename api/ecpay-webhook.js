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
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    // 月份格式：從 MerTradeNo 取 YYYYMM（格式：R/E + shortId(6) + YYYYMM(6) + ts(4)）
    let monthKey = currentMonthKey; // 預設用當月
    const monthStr = MerchantTradeNo?.slice(7, 13);
    if (monthStr?.length === 6 && /^20\d{4}$/.test(monthStr)) {
      monthKey = `${monthStr.slice(0,4)}-${monthStr.slice(4,6)}`;
    }

    console.log(`Room ${room.name} (${room.id}) ${isElec?'電費':'租金'} 付款 ${monthKey} vAccount:${vAccount}`);

    if (isElec) {
      // 電費付款：在房間新增「儲電通知 待處理」（跟手動儲電一樣的格式）
      const { data: roomFull } = await db
        .from('test_rooms')
        .select('elec_topups')
        .eq('id', room.id)
        .single();

      const elecTopups = roomFull?.elec_topups || [];
      const newTopup = {
        id:     'et' + Date.now(),
        amount: Number(TradeAmt),
        note:   `綠界自動到帳（帳號：${vAccount}）`,
        date:   now.toISOString().split('T')[0],
        status: 'pending',  // 待處理，等管理人確認度數
        by:     'ecpay_auto',
        tradeNo: TradeNo,
      };
      elecTopups.push(newTopup);

      await db.from('test_rooms')
        .update({ elec_topups: elecTopups })
        .eq('id', room.id);

      console.log(`✓ 已新增儲電通知 ${room.name} $${TradeAmt}`);
    } else {
      // 租金付款：upsert test_payments
      const { data: existing } = await db.from('test_payments')
        .select('*').eq('month_key', monthKey).eq('room_id', room.id).single();

      // 讀取房間的應收金額
      const { data: roomData } = await db
        .from('test_rooms')
        .select('rent,elec,elec_type')
        .eq('id', room.id)
        .single();

      const expectedAmt = (roomData?.rent || 0) + (roomData?.elec_type === 'monthly' ? (roomData?.elec || 0) : 0);
      const paidAmt = Number(TradeAmt);
      const diff = paidAmt - expectedAmt;

      // 判斷付款狀態
      let payStatus = 'paid';
      if (expectedAmt > 0 && paidAmt < expectedAmt) payStatus = 'partial'; // 部分付款
      // 超付還是標記已付款，但記錄實際金額

      const updateData = {
        month_key:       monthKey,
        room_id:         room.id,
        status:          payStatus,
        paid_at:         PaymentDate || now.toISOString(),
        method:          'ecpay_atm',
        actual_amount:   paidAmt,        // 實際付款金額
        diff_amount:     diff,           // 差額（正=超付，負=不足）
        updated_at:      now.toISOString(),
      };

      console.log(`付款比對：應收 ${expectedAmt}，實付 ${paidAmt}，差額 ${diff}，狀態 ${payStatus}`);

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
