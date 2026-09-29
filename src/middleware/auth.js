import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * Authenticate via a ClearWords-issued JWT.
 * Tokens are signed with JWT_SECRET (HS256) and carry:
 *   - sub: the user's MongoDB _id
 *   - email: for logging/debugging
 *   - iat / exp: standard
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