import express from 'express';
import User from '../models/User.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/users/:identifier
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

        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({
            id: user._id,
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
            timezoneOffsetMinutes: user.timezoneOffsetMinutes,
            learningLanguages: user.learningLanguages,
            teachingLanguages: user.teachingLanguages,
            subscriptionTier: user.subscriptionTier,
            podsJoined: user.podsJoined,
            activePairs: user.activePairs,
            cardsShared: user.cardsShared,
            createdAt: user.createdAt
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/users/profile
 */
router.put('/profile', authenticateUser, async (req, res) => {
    const {
        fullName, username, bio, location, language, segment,
        isPublic, learningLanguages, teachingLanguages,
        timezoneOffsetMinutes
    } = req.body;

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (username && username !== user.username) {
            const existing = await User.findOne({ username });
            if (existing) return res.status(409).json({ error: 'Username already taken' });
            user.username = username;
        }

        user.fullName = fullName || user.fullName;
        user.bio = bio || user.bio;
        user.location = location || user.location;
        user.language = language || user.language;
        user.segment = segment || user.segment;
        user.isPublic = isPublic !== undefined ? isPublic : user.isPublic;

        if (Array.isArray(learningLanguages)) user.learningLanguages = learningLanguages;
        if (Array.isArray(teachingLanguages)) user.teachingLanguages = teachingLanguages;
        if (typeof timezoneOffsetMinutes === 'number') user.timezoneOffsetMinutes = timezoneOffsetMinutes;

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
            isPublic: user.isPublic,
            learningLanguages: user.learningLanguages,
            teachingLanguages: user.teachingLanguages,
            timezoneOffsetMinutes: user.timezoneOffsetMinutes
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/users/:userId/stats
 */
router.get('/:userId/stats', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({
            podsJoined: user.podsJoined,
            activePairs: user.activePairs,
            cardsShared: user.cardsShared,
            referralCount: user.referralCount
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;