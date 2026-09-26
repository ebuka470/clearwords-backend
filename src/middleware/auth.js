import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import User from '../models/User.js';

// ============================================
// AUTH0 JWKS CLIENT (cached signing keys)
// ============================================
const jwks = jwksClient({
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
    timeout: 5000
});

function getSigningKey(header, callback) {
    jwks.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.getPublicKey());
    });
}

/**
 * Verify a token using either:
 *   - RS256 (Auth0 default) via JWKS
 *   - HS256 (shared secret) via JWT_SECRET
 * Chosen automatically based on the token's `alg` header.
 */
function verifyToken(token) {
    return new Promise((resolve, reject) => {
        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || !decoded.header) {
            return reject(new Error('Invalid token format'));
        }

        const alg = decoded.header.alg;

        const options = {
            audience: process.env.AUTH0_AUDIENCE,
            issuer: `https://${process.env.AUTH0_DOMAIN}/`,
            algorithms: alg === 'HS256' ? ['HS256'] : ['RS256']
        };

        if (alg === 'HS256') {
            if (!process.env.JWT_SECRET) {
                return reject(new Error('JWT_SECRET not configured'));
            }
            jwt.verify(token, process.env.JWT_SECRET, options, (err, payload) => {
                if (err) return reject(err);
                resolve(payload);
            });
        } else {
            jwt.verify(token, getSigningKey, options, (err, payload) => {
                if (err) return reject(err);
                resolve(payload);
            });
        }
    });
}

/**
 * Authenticate user via JWT token.
 * Auto-provisions a user record on first authenticated request if needed.
 */
export async function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = await verifyToken(token);

        let user = await User.findOne({ auth0Id: decoded.sub });

        if (!user) {
            const namespacedEmail = decoded[`${process.env.AUTH0_AUDIENCE}/email`];
            user = await User.create({
                auth0Id: decoded.sub,
                email: decoded.email || namespacedEmail || '',
                fullName: decoded.name || decoded.nickname || decoded.email?.split('@')[0] || 'User'
            });
        }

        if (user.isBanned) {
            return res.status(403).json({ error: 'Account is banned' });
        }

        user.lastActive = new Date();
        user.lastSeen = new Date();
        await user.save();

        req.user = user;
        req.userId = user._id;
        next();

    } catch (error) {
        console.error('Auth error:', error.message);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired, please refresh' });
        }

        return res.status(401).json({ error: 'Unauthorized: ' + error.message });
    }
}