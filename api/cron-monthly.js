// api/cron-monthly.js
// Vercel Cron Job：每月1號自動幫所有房間取 PAYUNi 虛擬帳號
// 在 vercel.json 設定：{ "crons": [{ "path": "/api/cron-monthly", "schedule": "0 2 1 * *" }] }
// 每月1號 台灣時間 早上10:00（UTC+8 = UTC 02:00）執行

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.SUPABASE_URL || 'https://fuvfvfmprxnhwxkexmtr.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://testbestmanagemant.vercel.app';

export default async function handler(req, res) {
  // 驗證是 Vercel Cron 呼叫（或手動測試）
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && 
      req.headers['x-api-key'] !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient(SUPA_URL, SUPA_KEY);
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  console.log(`Cron: Starting monthly ATM generation for ${monthKey}`);

  const results = { success: [], failed: [], skipped: [] };

  try {
    // ── 讀取所有有租客的房間 ──
    const { data: rooms, error } = await db
      .from('test_rooms')
      .select('id, name, addr, tenant, rent, elec, elec_type, org_id')
      .not('tenant', 'is', null)
      .neq('tenant', '');

    if (error) throw error;
    console.log(`Cron: Found ${rooms.length} rooms with tenants`);

    // ── 讀取組織設定（收款方式）──
    const { data: orgs } = await db
      .from('test_organizations')
      .select('id, name, payment_type, payuni_mer_id');

    const orgMap = {};
    (orgs || []).forEach(o => { orgMap[o.id] = o; });

    // ── 逐間房間取號 ──
    for (const room of rooms) {
      // 確認這個組織是否使用 PAYUNi
      const org = orgMap[room.org_id];
      const paymentType = org?.payment_type || 'manual';

      if (paymentType !== 'payuni') {
        results.skipped.push({ roomId: room.id, reason: `payment_type=${paymentType}` });
        continue;
      }

      const amount = (room.rent || 0) + (room.elec_type === 'monthly' ? (room.elec || 0) : 0);

      if (amount <= 0) {
        results.skipped.push({ roomId: room.id, reason: 'amount=0' });
        continue;
      }

      // MerTradeNo 格式：roomId_月份
      const merTradeNo = `${room.id}_${monthKey}`.replace(/[^A-Za-z0-9\-_]/g, '').slice(0, 25);

      try {
        const atmRes = await fetch(`${BASE_URL}/api/payuni-atm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': INTERNAL_API_KEY,
          },
          body: JSON.stringify({
            roomId: room.id,
            roomName: room.name,
            amount,
            merTradeNo,
            bankType: '004', // 玉山銀行
          }),
        });

        const atmData = await atmRes.json();

        if (atmData.success && atmData.payNo) {
          // 存虛擬帳號到 test_rooms
          await db
            .from('test_rooms')
            .update({
              acc: atmData.payNo,
              bank_last5: atmData.payNo.slice(-5),
            })
            .eq('id', room.id);

          results.success.push({
            roomId: room.id,
            roomName: room.name,
            payNo: atmData.payNo,
            amount,
          });

          // 間隔 500ms 避免 API 限流
          await new Promise(r => setTimeout(r, 500));

        } else {
          results.failed.push({
            roomId: room.id,
            roomName: room.name,
            error: atmData.message || 'ATM API failed',
          });
        }

      } catch (roomErr) {
        results.failed.push({
          roomId: room.id,
          roomName: room.name,
          error: roomErr.message,
        });
      }
    }

    // ── 寫入 Log ──
    await db.from('test_audit_log').insert({
      user_id: 'cron',
      user_name: 'Vercel Cron',
      action: '每月自動取號',
      target: monthKey,
      detail: `成功：${results.success.length} 間，失敗：${results.failed.length} 間，跳過：${results.skipped.length} 間`,
    });

    console.log('Cron completed:', results);
    return res.status(200).json({
      monthKey,
      summary: {
        success: results.success.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
      },
      details: results,
    });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
