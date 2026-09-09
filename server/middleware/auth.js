// ============================================================
// AUTH MIDDLEWARE - PostgreSQL Edition
// Decodes JWT token and verifies user against PostgreSQL database.
// ============================================================
const jwt = require('jsonwebtoken');

function createAuthMiddleware(db) {
    return async function authenticateToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        // Try our own JWT first (for fallback email/password without Firebase)
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = { id: decoded.id, email: decoded.email, name: decoded.name };
            return next();
        } catch (jwtErr) {
            // Not our JWT — try decoding as Firebase token
        }

        // Decode Firebase ID token (client-verified, we just read the payload)
        try {
            const parts = token.split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

                if (payload.email) {
                    // Look up user in our PostgreSQL DB
                    const result = await db.query('SELECT id, email, name FROM users WHERE email = $1', [payload.email]);
                    const dbUser = result.rows[0];

                    if (dbUser) {
                        req.user = { id: dbUser.id, email: dbUser.email, name: dbUser.name };
                        return next();
                    } else {
                        return res.status(404).json({
                            error: 'User not found. Please complete registration first.'
                        });
                    }
                }
            }
        } catch (decodeErr) {
            // Not a valid token at all
        }

        return res.status(403).json({ error: 'Invalid or expired token.' });
    };
}

module.exports = { createAuthMiddleware };
