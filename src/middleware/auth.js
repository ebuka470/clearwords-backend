import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * Shared token verifier — used by both middlewares below.
 * Returns the decoded payload, or null if the token is missing/invalid.
 */
function verifyToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.split(' ')[1];
    try {
        return jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256']
        });
    } catch {
        return null;
    }
}

/**
 * Returns true if the token was issued before the user's last password
 * change. In that case the token should be treated as expired, even if
 * its `exp` claim is still in the future.
 */
function tokenPredatesPasswordChange(decoded, user) {
    if (!user.passwordChangedAt) return false;
    if (!decoded.iat) return false;
    return decoded.iat * 1000 < user.passwordChangedAt.getTime();
}

/**
 * Authenticate via a ClearWords-issued JWT.
 * Rejects the request (401/403) if the token is missing, invalid,
 * belongs to a deleted user, belongs to a banned user, or was issued
 * before the user's last password change.
 */
export async function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256']
        });

        const user = await User.findById(decoded.sub);
        if (!user) {
            return res.status(401).json({ error: 'User no longer exists' });
        }
        if (user.isBanned) {
            return res.status(403).json({ error: 'Account is banned' });
        }
        if (tokenPredatesPasswordChange(decoded, user)) {
            return res.status(401).json({
                error: 'Session expired — please log in again'
            });
        }

        user.lastActive = new Date();
        user.lastSeen = new Date();
        await user.save();

        req.user = user;
        req.userId = user._id;
        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('Auth error:', error.message);
        return res.status(401).json({ error: 'Unauthorized' });
    }
}

/**
 * Optional authentication.
 * Used on GET /api/users/:identifier where the route must work for
 * both anonymous visitors AND the logged-in owner.
 *   - Valid token (and not stale) → req.user + req.userId populated
 *   - No / invalid / stale token → req.user = null, req.userId = null
 * Never rejects the request.
 */
export async function authenticateOptionalUser(req, res, next) {
    const decoded = verifyToken(req);

    if (!decoded) {
        req.user = null;
        req.userId = null;
        return next();
    }

    try {
        const user = await User.findById(decoded.sub);

        if (user && !user.isBanned && !tokenPredatesPasswordChange(decoded, user)) {
            user.lastActive = new Date();
            user.lastSeen = new Date();
            await user.save();

            req.user = user;
            req.userId = user._id;
        } else {
            req.user = null;
            req.userId = null;
        }
    } catch (err) {
        console.warn('Optional auth lookup failed:', err.message);
        req.user = null;
        req.userId = null;
    }

    next();
}