// Middleware: Verifies that IoT requests (from ESP32) include the correct API key
// The ESP32 must send this header:  x-api-key: <your IOT_API_KEY from .env>

const crypto = require('crypto');

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = function iotAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.IOT_API_KEY;

  if (!apiKey || !expectedKey || !safeCompare(apiKey, expectedKey)) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing IoT API key' });
  }

  next();
};
