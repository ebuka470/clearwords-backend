const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Progress = require('../models/Progress');

/**
 * POST /api/auth/signup
 * Create user after Auth0 signup
 */
router.post('/signup', async (req, res) => {
    const { auth0Id, email, fullName, segment, language, phone } = req.body;

    if (!auth0Id || !email) {
        return res.status(400).json({ error: 'auth0Id and email are required' });
    }

    try {
        let user = await User.findOne({ auth0Id });
        if (user) {
            return res.status(409).json({ error: 'User already exists', user });
        }

        user = await User.create({
            auth0Id,
            email,
            fullName: fullName || email.split('@')[0],
            phone: phone || '',
            segment: segment || 'young',
            language: language || 'yoruba'
        });

        await Progress.create({
            userId: user._id,
            language: language || 'yoruba',
            completedLevels: [],
            totalXP: 0,
            streak: 0,
            currentLevel: 1
        });

        res.status(201).json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                fullName: user.fullName,
                segment: user.segment,
                language: user.language
            }
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(400).json({ error: error.message || 'Signup failed' });
    }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            audience: process.env.AUTH0_AUDIENCE,
            issuer: `https://${process.env.AUTH0_DOMAIN}/`
        });

        const user = await User.findOne({ auth0Id: decoded.sub });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user._id,
            auth0Id: user.auth0Id,
            email: user.email,
            fullName: user.fullName,
            segment: user.segment,
            language: user.language,
            subscriptionTier: user.subscriptionTier,
            subscriptionExpires: user.subscriptionExpires,
            referralCode: user.referralCode,
            avatarUrl: user.avatarUrl,
            username: user.username,
            bio: user.bio,
            location: user.location,
            isVerified: user.isVerified,
            followersCount: user.followersCount,
            followingCount: user.followingCount,
            postsCount: user.postsCount
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(401).json({ error: 'Unauthorized' });
    }
});

module.exports = router;