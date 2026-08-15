const express = require('express');
const router = express.Router();
const Follow = require('../models/Follow');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { authenticateUser } = require('../middleware/auth');

/**
 * POST /api/follow/:userId
 * Follow a user
 */
router.post('/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;

    if (userId === req.userId) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    try {
        const userToFollow = await User.findById(userId);
        if (!userToFollow) {
            return res.status(404).json({ error: 'User not found' });
        }

        const existing = await Follow.findOne({
            followerId: req.userId,
            followingId: userId
        });

        if (existing) {
            return res.status(400).json({ error: 'Already following' });
        }

        const follow = await Follow.create({
            followerId: req.userId,
            followingId: userId
        });

        await User.findByIdAndUpdate(req.userId, { $inc: { followingCount: 1 } });
        await User.findByIdAndUpdate(userId, { $inc: { followersCount: 1 } });

        // Create notification
        if (userId.toString() !== req.userId) {
            const user = await User.findById(req.userId);
            await Notification.create({
                userId: userId,
                type: 'follow',
                sourceId: req.userId,
                sourceUsername: user.username || 'User',
                sourceAvatar: user.avatarUrl || '',
                targetId: req.userId,
                targetType: 'user',
                content: `${user.fullName || 'Someone'} started following you`,
                data: {}
            });
        }

        res.json({ success: true, isFollowing: true });

    } catch (error) {
        console.error('Follow error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/follow/:userId
 * Unfollow a user
 */
router.delete('/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await Follow.findOneAndDelete({
            followerId: req.userId,
            followingId: userId
        });

        if (!result) {
            return res.status(400).json({ error: 'Not following' });
        }

        await User.findByIdAndUpdate(req.userId, { $inc: { followingCount: -1 } });
        await User.findByIdAndUpdate(userId, { $inc: { followersCount: -1 } });

        res.json({ success: true, isFollowing: false });

    } catch (error) {
        console.error('Unfollow error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/follow/check/:userId
 * Check if following a user
 */
router.get('/check/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;

    try {
        const follow = await Follow.findOne({
            followerId: req.userId,
            followingId: userId
        });

        res.json({ isFollowing: !!follow });

    } catch (error) {
        console.error('Check follow error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;