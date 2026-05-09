// api/debug-room.js - 臨時測試用，確認後刪掉
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.SUPABASE_URL || 'https://fuvfvfmprxnhwxkexmtr.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { vAccount } = req.query;
  const db = createClient(SUPA_URL, SUPA_KEY);

  // 直接查所有 acc 欄位
  const { data, error } = await db
    .from('test_rooms')
    .select('id,name,acc,elec_acc')
    .not('acc', 'is', null);

  // 嘗試精確比對
  const { data: exact, error: exactErr } = await db
    .from('test_rooms')
    .select('id,name,acc')
    .eq('acc', vAccount);

  return res.status(200).json({
    supaKey: SUPA_KEY ? 'SET' : 'NOT SET',
    allRoomsWithAcc: data,
    error: error?.message,
    exactMatch: exact,
    exactError: exactErr?.message,
    searchedFor: vAccount,
  });
};
