import express from 'express';
import Pair from '../models/Pair.js';
import PairMessage from '../models/PairMessage.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';
import { moderationMiddleware } from '../middleware/moderation.js';
import { canCreatePair, getUserLimits } from '../middleware/tierGate.js';

const router = express.Router();

/**
 * GET /api/pairs
 * List current user's active pairs
 */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const pairs = await Pair.find({
            $or: [{ userA: req.userId }, { userB: req.userId }],
            status: 'active'
        })
        .populate('userA', 'fullName username avatarUrl learningLanguages teachingLanguages')
        .populate('userB', 'fullName username avatarUrl learningLanguages teachingLanguages')
        .sort({ lastActivityAt: -1 });

        res.json({ data: pairs, total: pairs.length });
    } catch (error) {
        console.error('Get pairs error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pairs/request
 * Request a match with another user
 */
router.post('/request', authenticateUser, async (req, res) => {
    const { targetUserId, languageA, languageB } = req.body;

    if (!targetUserId || !languageA || !languageB) {
        return res.status(400).json({ error: 'targetUserId, languageA, languageB are required' });
    }

    if (targetUserId === req.userId) {
        return res.status(400).json({ error: 'Cannot pair with yourself' });
    }

    try {
        const user = await User.findById(req.userId);
        const target = await User.findById(targetUserId);
        if (!target) return res.status(404).json({ error: 'Target user not found' });

        const canPair = await canCreatePair(user);
        if (!canPair) {
            return res.status(403).json({
                error: 'Pair limit reached for your tier',
                currentTier: user.subscriptionTier
            });
        }

        const existing = await Pair.findOne({
            status: { $in: ['pending', 'active'] },
            $or: [
                { userA: req.userId, userB: targetUserId },
                { userA: targetUserId, userB: req.userId }
            ]
        });
        if (existing) return res.status(400).json({ error: 'Pair already exists' });

        const limits = getUserLimits(user);

        const pair = await Pair.create({
            userA: req.userId,
            userB: targetUserId,
            languageA,
            languageB,
            status: 'pending',
            voiceEnabled: limits.voice,
            videoEnabled: limits.video
        });

        await Notification.create({
            userId: targetUserId,
            type: 'pair_matched',
            sourceId: user._id,
            sourceUsername: user.username || 'User',
            sourceAvatar: user.avatarUrl || '',
            pairId: pair._id,
            content: `${user.fullName || 'Someone'} wants to pair with you`
        });

        res.status(201).json(pair);
    } catch (error) {
        console.error('Pair request error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pairs/:pairId/accept
 */
router.post('/:pairId/accept', authenticateUser, async (req, res) => {
    const { pairId } = req.params;

    try {
        const pair = await Pair.findById(pairId);
        if (!pair) return res.status(404).json({ error: 'Pair not found' });

        if (pair.userB.toString() !== req.userId && pair.userA.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not part of this pair' });
        }

        if (pair.status !== 'pending') {
            return res.status(400).json({ error: 'Pair is not pending' });
        }

        pair.status = 'active';
        pair.lastActivityAt = new Date();
        await pair.save();

        // Update both users' active pair counts
        await User.findByIdAndUpdate(pair.userA, { $inc: { activePairs: 1 } });
        await User.findByIdAndUpdate(pair.userB, { $inc: { activePairs: 1 } });

        res.json({ success: true, pair });
    } catch (error) {
        console.error('Accept pair error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/pairs/:pairId
 * End a pair (either user can end)
 */
router.delete('/:pairId', authenticateUser, async (req, res) => {
    const { pairId } = req.params;
    const { reason } = req.body;

    try {
        const pair = await Pair.findById(pairId);
        if (!pair) return res.status(404).json({ error: 'Pair not found' });

        if (pair.userA.toString() !== req.userId && pair.userB.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not part of this pair' });
        }

        pair.status = 'ended';
        pair.endedAt = new Date();
        pair.endedBy = req.userId;
        pair.endReason = reason === 'report' ? 'report' : 'manual';
        await pair.save();

        await User.findByIdAndUpdate(pair.userA, { $inc: { activePairs: -1 } });
        await User.findByIdAndUpdate(pair.userB, { $inc: { activePairs: -1 } });

        const otherUserId = pair.userA.toString() === req.userId ? pair.userB : pair.userA;
        await Notification.create({
            userId: otherUserId,
            type: 'pair_ended',
            pairId: pair._id,
            content: 'Your language exchange pair has ended'
        });

        res.json({ success: true });
    } catch (error) {
        console.error('End pair error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/pairs/:pairId/messages
 */
router.get('/:pairId/messages', authenticateUser, async (req, res) => {
    const { pairId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    try {
        const pair = await Pair.findById(pairId);
        if (!pair) return res.status(404).json({ error: 'Pair not found' });

        if (pair.userA.toString() !== req.userId && pair.userB.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not part of this pair' });
        }

        const skip = (page - 1) * limit;
        const messages = await PairMessage.find({ pairId, isDeleted: false })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        pair.lastActivityAt = new Date();
        await pair.save();

        res.json({ data: messages.reverse(), page, limit });
    } catch (error) {
        console.error('Get pair messages error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pairs/:pairId/messages
 */
router.post('/:pairId/messages', authenticateUser, moderationMiddleware, async (req, res) => {
    const { pairId } = req.params;
    const { text } = req.body;

    if (!text) return res.status(400).json({ error: 'text is required' });

    try {
        const pair = await Pair.findById(pairId);
        if (!pair) return res.status(404).json({ error: 'Pair not found' });

        if (pair.status !== 'active') {
            return res.status(400).json({ error: 'Pair is not active' });
        }

        if (pair.userA.toString() !== req.userId && pair.userB.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not part of this pair' });
        }

        const message = await PairMessage.create({
            pairId,
            senderId: req.userId,
            text
        });

        pair.lastActivityAt = new Date();
        await pair.save();

        res.status(201).json(message);
    } catch (error) {
        console.error('Send pair message error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/pairs/:pairId/messages/:messageId
 * Edit a pair message (sender only, within 15 min)
 */
router.put('/:pairId/messages/:messageId', authenticateUser, moderationMiddleware, async (req, res) => {
    const { pairId, messageId } = req.params;
    const { text } = req.body;

    if (!text) return res.status(400).json({ error: 'text is required' });

    try {
        const message = await PairMessage.findById(messageId);
        if (!message || message.pairId.toString() !== pairId) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.senderId.toString() !== req.userId) {
            return res.status(403).json({ error: 'You can only edit your own messages' });
        }

        const ageMs = Date.now() - new Date(message.createdAt).getTime();
        if (ageMs > 15 * 60 * 1000) {
            return res.status(400).json({ error: 'Messages can only be edited within 15 minutes' });
        }

        message.text = text;
        await message.save();

        res.json({ success: true, message });
    } catch (error) {
        console.error('Edit pair message error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/pairs/:pairId/messages/:messageId
 */
router.delete('/:pairId/messages/:messageId', authenticateUser, async (req, res) => {
    const { pairId, messageId } = req.params;

    try {
        const message = await PairMessage.findById(messageId);
        if (!message || message.pairId.toString() !== pairId) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.senderId.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        message.isDeleted = true;
        message.text = '[deleted]';
        await message.save();

        res.json({ success: true });
    } catch (error) {
        console.error('Delete pair message error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pairs/:pairId/messages/read
 * Mark all pair messages as read (up to now)
 */
router.post('/:pairId/messages/read', authenticateUser, async (req, res) => {
    const { pairId } = req.params;

    try {
        const pair = await Pair.findById(pairId);
        if (!pair) return res.status(404).json({ error: 'Pair not found' });

        if (pair.userA.toString() !== req.userId && pair.userB.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not part of this pair' });
        }

        // Mark messages NOT sent by the current user as read
        await PairMessage.updateMany(
            { pairId, senderId: { $ne: req.userId }, readAt: null },
            { readAt: new Date() }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;