import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function getTokenFromRequest(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.slice(7).trim();

    return token || null;
}

export function signToken(user) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
    }

    return jwt.sign(
        {
            userId: user._id.toString()
        },
        process.env.JWT_SECRET,
        {
            expiresIn: JWT_EXPIRES_IN
        }
    );
}

export function verifyToken(token) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
    }

    return jwt.verify(token, process.env.JWT_SECRET);
}

export async function authenticateUser(req, res, next) {
    const token = getTokenFromRequest(req);

    if (!token) {
        return res.status(401).json({
            error: 'Authentication required'
        });
    }

    try {
        const decoded = verifyToken(token);

        if (!decoded || !decoded.userId) {
            return res.status(401).json({
                error: 'Invalid authentication token'
            });
        }

        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({
                error: 'User account no longer exists'
            });
        }

        if (user.deletedAt) {
            return res.status(401).json({
                error: 'This account has been deleted'
            });
        }

        if (user.isBanned) {
            return res.status(403).json({
                error: 'Account is banned'
            });
        }

        if (user.isActive === false) {
            return res.status(403).json({
                error: 'Account is inactive'
            });
        }

        const now = new Date();

        user.lastActive = now;
        user.lastSeen = now;

        await user.save();

        req.user = user;
        req.userId = user._id;

        return next();
    } catch (error) {
        console.error('Auth error:', error.message);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Session expired. Please log in again.'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid authentication token'
            });
        }

        return res.status(401).json({
            error: 'Authentication failed'
        });
    }
}

/**
 * Optional authentication.
 *
 * Public routes can use this when they want to know whether
 * the requester is logged in without requiring authentication.
 */
export async function authenticateOptionalUser(req, res, next) {
    const token = getTokenFromRequest(req);

    req.user = null;
    req.userId = null;

    if (!token) {
        return next();
    }

    try {
        const decoded = verifyToken(token);

        if (!decoded || !decoded.userId) {
            return next();
        }

        const user = await User.findById(decoded.userId);

        if (!user || user.deletedAt || user.isBanned || user.isActive === false) {
            return next();
        }

        req.user = user;
        req.userId = user._id;

        return next();
    } catch {
        return next();
    }
}

export default authenticateUser;