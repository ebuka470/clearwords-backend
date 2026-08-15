const express = require('express');
const router = express.Router();
const Progress = require('../models/Progress');
const User = require('../models/User');
const { authenticateUser } = require('../middleware/auth');

/**
 * GET /api/progress
 * Get user progress
 */
router.get('/', authenticateUser, async (req, res) => {
    const { language } = req.query;

    try {
        const query = { userId: req.userId };
        if (language) query.language = language;

        let progress = await Progress.findOne(query);

        if (!progress) {
            progress = await Progress.create({
                userId: req.userId,
                language: language || 'yoruba',
                completedLevels: [],
                totalXP: 0,
                streak: 0,
                currentLevel: 1
            });
        }

        res.json(progress);

    } catch (error) {
        console.error('Get progress error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/progress/sync
 * Sync user progress
 */
router.post('/sync', authenticateUser, async (req, res) => {
    const {
        language,
        completedLevels,
        totalXP,
        streak,
        currentLevel,
        dailyCompleted,
        perfectScores,
        favorites,
        dailyChallenges,
        lastChallengeGen
    } = req.body;

    if (!language) {
        return res.status(400).json({ error: 'Language is required' });
    }

    try {
        const progress = await Progress.findOneAndUpdate(
            { userId: req.userId, language },
            {
                completedLevels: completedLevels || [],
                totalXP: totalXP || 0,
                streak: streak || 0,
                currentLevel: currentLevel || 1,
                dailyCompleted: dailyCompleted || 0,
                perfectScores: perfectScores || 0,
                favorites: favorites || [],
                dailyChallenges: dailyChallenges || [],
                lastChallengeGen: lastChallengeGen || null,
                lastActive: new Date()
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        await User.findByIdAndUpdate(req.userId, { lastActive: new Date() });

        res.json({ success: true, data: progress });

    } catch (error) {
        console.error('Sync error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/progress/:language
 * Reset progress for a language
 */
router.delete('/:language', authenticateUser, async (req, res) => {
    const { language } = req.params;

    try {
        await Progress.findOneAndDelete({ userId: req.userId, language });

        const progress = await Progress.create({
            userId: req.userId,
            language,
            completedLevels: [],
            totalXP: 0,
            streak: 0,
            currentLevel: 1
        });

        res.json({ success: true, data: progress });

    } catch (error) {
        console.error('Reset progress error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;