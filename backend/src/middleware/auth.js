// Middleware: Verifies signed session tokens or Supabase JWTs for dashboard access
// Supported formats:
// 1. Signed session token: Authorization: Bearer att.<payload_b64>.<sig_b64>
// 2. Supabase GoTrue JWT: Authorization: Bearer <jwt>
// 3. Dev tokens (non-production): Bearer dev-token

const supabase = require('../supabase');
const { verifyToken } = require('../utils/token');

module.exports = async function auth(req, res, next) {
  const authHeader = req.headers['authorization'];

  // If no token is provided:
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // In local development or prototype testing, allow seamless access if DEV_BYPASS_AUTH is enabled
    if (process.env.DEV_BYPASS_AUTH === 'true') {
      req.user = {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'admin@dev.local',
        role: 'admin'
      };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized — no token provided' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized — empty bearer token' });
  }

  // Explicit dev token support
  if (token === 'dev-token' || token === 'test-token') {
    if (process.env.NODE_ENV !== 'production') {
      req.user = {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'admin@dev.local',
        role: 'admin'
      };
      return next();
    }
  }

  // 1. Cryptographically signed HMAC session token
  if (token.startsWith('att.')) {
    const verification = verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({
        error: `Unauthorized — ${verification.error || 'invalid or expired session'}`
      });
    }

    req.user = {
      ...verification.payload,
      id: verification.payload.id || verification.payload.student_id || verification.payload.instructor_id
    };
    return next();
  }

  // 2. Supabase Auth JWT token check
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
    }

    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized — auth verification failure' });
  }
};
