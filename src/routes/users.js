const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Follow = require('../models/Follow');
const { authenticateUser } = require('../middleware/auth');

/**
 * GET /api/users/:identifier
 * Get user profile by ID or username
 */
router.get('/:identifier', async (req, res) => {
    const { identifier } = req.params;

    try {
        let user;
        if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
            user = await User.findById(identifier);
        } else {
            user = await User.findOne({ username: identifier.replace('@', '') });
        }

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user._id,
            email: user.email,
            fullName: user.fullName,
            username: user.username,
            bio: user.bio,
            location: user.location,
            avatarUrl: user.avatarUrl,
            coverPhotoUrl: user.coverPhotoUrl,
            isVerified: user.isVerified,
            isPublic: user.isPublic,
            segment: user.segment,
            language: user.language,
            followersCount: user.followersCount,
            followingCount: user.followingCount,
            postsCount: user.postsCount,
            createdAt: user.createdAt
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/users/profile
 * Update user profile
 */
router.put('/profile', authenticateUser, async (req, res) => {
    const { fullName, username, bio, location, language, segment, isPublic } = req.body;

    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (username && username !== user.username) {
            const existing = await User.findOne({ username });
            if (existing) {
                return res.status(409).json({ error: 'Username already taken' });
            }
            user.username = username;
        }

        user.fullName = fullName || user.fullName;
        user.bio = bio || user.bio;
        user.location = location || user.location;
        user.language = language || user.language;
        user.segment = segment || user.segment;
        user.isPublic = isPublic !== undefined ? isPublic : user.isPublic;

        await user.save();

        res.json({
            id: user._id,
            email: user.email,
            fullName: user.fullName,
            username: user.username,
            bio: user.bio,
            location: user.location,
            avatarUrl: user.avatarUrl,
            language: user.language,
            segment: user.segment,
            isPublic: user.isPublic
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/users/:userId/stats
 * Get user stats
 */
router.get('/:userId/stats', async (req, res) => {
    const { userId } = req.params;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            followersCount: user.followersCount,
            followingCount: user.followingCount,
            postsCount: user.postsCount,
            likesReceived: user.likesReceived,
            referralCount: user.referralCount
        });

    } catch (error) {
        console.error('Get stats error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;