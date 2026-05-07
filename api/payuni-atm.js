const crypto = require('crypto');
module.exports = async function handler(req, res) {
  const body = req.body || {};
  res.status(200).json({ ok: true, body, method: req.method });
};
