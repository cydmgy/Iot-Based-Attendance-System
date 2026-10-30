const crypto = require('crypto');

// Secret used for HMAC signing of session tokens.
// Priority: SESSION_SECRET → SUPABASE_SERVICE_ROLE_KEY → fatal startup error.
// Set SESSION_SECRET in your hosting platform's environment variables.
const getSecret = () => {
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    // Crash loudly at startup rather than silently using a weak static fallback.
    throw new Error(
      '[token.js] FATAL: SESSION_SECRET (or SUPABASE_SERVICE_ROLE_KEY) is not set. ' +
      'Set SESSION_SECRET in your environment variables before starting the server.'
    );
  }
  return secret;
};

/**
 * Generate a cryptographically signed HMAC-SHA256 session token
 * @param {Object} payload - Data to embed in the token (e.g., id, role, student_id, email)
 * @param {number} expiresInSeconds - Expiration time in seconds (default: 7 days)
 * @returns {string} Signed token: att.<b64Payload>.<b64Sig>
 */
function generateToken(payload, expiresInSeconds = 7 * 24 * 3600) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + expiresInSeconds;

  const data = {
    ...payload,
    iat: issuedAt,
    exp: expiresAt,
    nonce: crypto.randomBytes(8).toString('hex')
  };

  const payloadB64 = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');

  return `att.${payloadB64}.${signature}`;
}

/**
 * Verify and decode an HMAC-SHA256 signed session token
 * @param {string} token
 * @returns {{ valid: boolean, payload?: Object, error?: string }}
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing or invalid token format' };
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'att') {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [, payloadB64, providedSig] = parts;

  // Recalculate signature
  const expectedSig = crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');

  // Timing-safe comparison to prevent timing attacks
  const sigBufferA = Buffer.from(providedSig);
  const sigBufferB = Buffer.from(expectedSig);

  if (sigBufferA.length !== sigBufferB.length || !crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    // Expiration check
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token has expired' };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: 'Failed to parse token payload' };
  }
}

module.exports = {
  generateToken,
  verifyToken
};
