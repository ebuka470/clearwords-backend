const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Authenticate user via JWT token
 */
async function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            audience: process.env.AUTH0_AUDIENCE,
            issuer: `https://${process.env.AUTH0_DOMAIN}/`
        });

        let user = await User.findOne({ auth0Id: decoded.sub });

        if (!user) {
            user = await User.create({
                auth0Id: decoded.sub,
                email: decoded.email,
                fullName: decoded.name || decoded.email?.split('@')[0] || 'User'
            });
        }

        user.lastActive = new Date();
        await user.save();

        req.user = user;
        req.userId = user._id;
        next();

    } catch (error) {
        console.error('Auth error:', error.message);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired, please refresh' });
        }

        res.status(401).json({ error: 'Unauthorized: ' + error.message });
    }
}

module.exports = { authenticateUser };