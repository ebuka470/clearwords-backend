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
 * Request a specific partner by ID
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
        if (target.isBanned) return res.status(403).json({ error: 'Target user is unavailable' });

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
 * POST /api/pairs/match
 * Auto-match the current user with an ideal language exchange partner.
 *
 * Logic:
 *   1. What languages does the current user want to LEARN?
 *   2. What languages can the current user TEACH?
 *   3. Find other users where:
 *        - they teach one of my learning languages
 *        - they learn one of my teaching languages
 *        - they are not banned, active, not already paired with me
 *   4. Rank by language overlap, same primary language, recent activity
 *   5. Create an active pair and notify both sides
 */
router.post('/match', authenticateUser, async (req, res) => {
    const {
        languageLearning,
        languageTeaching,
        timezoneOffsetMinutes
    } = req.body;

    try {
        const me = await User.findById(req.userId);
        if (!me) return res.status(404).json({ error: 'User not found' });
        if (me.isBanned) return res.status(403).json({ error: 'Account is banned' });

        const myLearning = languageLearning?.length
            ? languageLearning
            : me.learningLanguages || [];

        const myTeaching = languageTeaching?.length
            ? languageTeaching
            : me.teachingLanguages || [];

        if (myLearning.length === 0 || myTeaching.length === 0) {
            return res.status(400).json({
                error: 'Set learningLanguages and teachingLanguages on your profile first'
            });
        }

        const canPair = await canCreatePair(me);
        if (!canPair) {
            return res.status(403).json({
                error: 'Pair limit reached for your tier',
                currentTier: me.subscriptionTier
            });
        }

        const existingPairs = await Pair.find({
            status: { $in: ['pending', 'active'] },
            $or: [{ userA: me._id }, { userB: me._id }]
        }).select('userA userB');

        const alreadyPairedWith = new Set();
        existingPairs.forEach(p => {
            alreadyPairedWith.add(p.userA.toString());
            alreadyPairedWith.add(p.userB.toString());
        });
        alreadyPairedWith.add(me._id.toString());

        const candidates = await User.find({
            _id: { $nin: Array.from(alreadyPairedWith) },
            isBanned: false,
            isActive: true,
            teachingLanguages: { $in: myLearning },
            learningLanguages: { $in: myTeaching }
        })
        .limit(20)
        .select('fullName username avatarUrl learningLanguages teachingLanguages language lastActive');

        if (candidates.length === 0) {
            return res.status(404).json({
                error: 'No matching partners found right now. Try again later.',
                hint: 'Check back once more users join your language combination.'
            });
        }

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        const scored = candidates.map(c => {
            let score = 0;
            const sharedLearning = c.teachingLanguages.filter(l => myLearning.includes(l));
            const sharedTeaching = c.learningLanguages.filter(l => myTeaching.includes(l));
            score += (sharedLearning.length + sharedTeaching.length) * 3;

            if (c.language && c.language === me.language) score += 2;
            if (c.lastActive && new Date(c.lastActive).getTime() > sevenDaysAgo) score += 1;

            return { candidate: c, score, sharedLearning, sharedTeaching };
        }).sort((a, b) => b.score - a.score);

        const best = scored[0];
        const target = best.candidate;

        const languageA = best.sharedLearning[0] || myLearning[0];
        const languageB = best.sharedTeaching[0] || myTeaching[0];

        const limits = getUserLimits(me);

        const pair = await Pair.create({
            userA: me._id,
            userB: target._id,
            languageA,
            languageB,
            status: 'active',
            voiceEnabled: limits.voice,
            videoEnabled: limits.video,
            matchedAt: new Date(),
            lastActivityAt: new Date()
        });

        await User.findByIdAndUpdate(me._id, { $inc: { activePairs: 1 } });
        await User.findByIdAndUpdate(target._id, { $inc: { activePairs: 1 } });

        await Notification.insertMany([
            {
                userId: target._id,
                type: 'pair_matched',
                sourceId: me._id,
                sourceUsername: me.username || 'User',
                sourceAvatar: me.avatarUrl || '',
                pairId: pair._id,
                content: `You were auto-matched with ${me.fullName || 'a learner'} for ${languageA} ↔ ${languageB}`
            },
            {
                userId: me._id,
                type: 'pair_matched',
                sourceId: target._id,
                sourceUsername: target.username || 'User',
                sourceAvatar: target.avatarUrl || '',
                pairId: pair._id,
                content: `You were auto-matched with ${target.fullName || 'a learner'} for ${languageA} ↔ ${languageB}`
            }
        ]);

        res.status(201).json({
            success: true,
            matched: true,
            pair,
            partner: {
                id: target._id,
                fullName: target.fullName,
                username: target.username,
                avatarUrl: target.avatarUrl
            }
        });

    } catch (error) {
        console.error('Pair match error:', error);
        res.status(500).json({ error: error.message });
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
 * End a pair
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

export default router;