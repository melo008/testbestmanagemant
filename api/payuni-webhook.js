// api/payuni-webhook.js
// PAYUNi 付款完成 Webhook
// 當租客匯款成功，PAYUNi 自動 POST 到這個 URL
// Notify URL：https://testbestmanagemant.vercel.app/api/payuni-webhook

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PAYUNI_HASH_KEY = process.env.PAYUNI_HASH_KEY;
const PAYUNI_HASH_IV  = process.env.PAYUNI_HASH_IV;

const SUPA_URL = process.env.SUPABASE_URL || 'https://fuvfvfmprxnhwxkexmtr.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY; // 用 Service Key（有寫入權限）

// ── AES 解密 ──
function aesDecrypt(encryptedHex) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(PAYUNI_HASH_KEY, 'utf8'),
    Buffer.from(PAYUNI_HASH_IV, 'utf8')
  );
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── 取得當月 Payment Key ──
function getCurrentMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const { EncryptInfo, HashInfo, MerID } = req.body;

    if (!EncryptInfo) {
      console.error('Webhook: No EncryptInfo received');
      return res.status(400).send('Missing EncryptInfo');
    }

    // ── 解密 PAYUNi 回傳資料 ──
    let params;
    try {
      const decrypted = aesDecrypt(EncryptInfo);
      params = Object.fromEntries(new URLSearchParams(decrypted));
    } catch (e) {
      console.error('Webhook decrypt error:', e);
      return res.status(400).send('Decrypt error');
    }

    console.log('PAYUNi Webhook received:', JSON.stringify(params));

    // ── 確認付款成功 ──
    // TradeStatus: 1=付款成功
    if (params.Status !== 'SUCCESS' || params.TradeStatus !== '1') {
      console.log('Webhook: Trade not successful, status:', params.Status, params.TradeStatus);
      return res.status(200).send('OK'); // 還是要回 200 給 PAYUNi
    }

    // ── 從 MerTradeNo 找到對應的房間 ──
    // MerTradeNo 格式：房間ID_月份  例如：room123_2026-05
    const merTradeNo = params.MerTradeNo || '';
    const parts = merTradeNo.split('_');
    const roomId = parts[0];
    const monthKey = parts[1] || getCurrentMonthKey();

    if (!roomId) {
      console.error('Webhook: Cannot parse roomId from MerTradeNo:', merTradeNo);
      return res.status(200).send('OK');
    }

    // ── 更新 Supabase 付款狀態 ──
    const db = createClient(SUPA_URL, SUPA_KEY);

    // 讀取目前的 payments
    const { data: paymentData, error: fetchErr } = await db
      .from('test_payments')
      .select('payments')
      .eq('month_key', monthKey)
      .single();

    let payments = paymentData?.payments || {};

    // 標記該房間已付款
    payments[roomId] = {
      ...payments[roomId],
      status: 'paid',
      paidAt: new Date().toISOString(),
      method: 'payuni_atm',
      tradeNo: params.TradeNo,       // PAYUNi 序號
      payNo: params.PayNo,           // 匯款帳號
      tradeAmt: params.TradeAmt,     // 實際付款金額
    };

    const { error: updateErr } = await db
      .from('test_payments')
      .upsert({
        month_key: monthKey,
        payments: payments,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'month_key' });

    if (updateErr) {
      console.error('Webhook: Supabase update error:', updateErr);
      // 還是回 200，避免 PAYUNi 重試
    } else {
      console.log(`Webhook: Room ${roomId} marked as paid for ${monthKey}`);

      // ── 同時寫入操作 Log ──
      await db.from('test_audit_log').insert({
        user_id: 'payuni_webhook',
        user_name: 'PAYUNi 自動對帳',
        action: '自動標記已付款',
        target: roomId,
        detail: `${monthKey} 虛擬帳號：${params.PayNo} 金額：$${params.TradeAmt}`,
      });
    }

    // ── 必須回傳 200 給 PAYUNi ──
    return res.status(200).send('OK');

  } catch (err) {
    console.error('Webhook error:', err);
    // 還是回 200，避免 PAYUNi 不斷重試
    return res.status(200).send('OK');
  }
}
