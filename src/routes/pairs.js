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
 * Compute effective voice/video flags for a pair.
 * Both users must have the entitlement for the pair to have it.
 */
function computePairFlags(userA, userB) {
    const a = getUserLimits(userA);
    const b = getUserLimits(userB);
    return {
        voiceEnabled: !!(a.voice && b.voice),
        videoEnabled: !!(a.video && b.video)
    };
}

/**
 * GET /api/pairs
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

        // Effective flags = AND of both users' entitlements
        const flags = computePairFlags(user, target);

        const pair = await Pair.create({
            userA: req.userId,
            userB: targetUserId,
            languageA,
            languageB,
            status: 'pending',
            ...flags
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
 */
router.post('/match', authenticateUser, async (req, res) => {
    const { languageLearning, languageTeaching, timezoneOffsetMinutes } = req.body || {};

    try {
        const me = await User.findById(req.userId);
        if (!me) return res.status(404).json({ error: 'User not found' });
        if (me.isBanned) return res.status(403).json({ error: 'Account is banned' });

        if (typeof timezoneOffsetMinutes === 'number') {
            me.timezoneOffsetMinutes = timezoneOffsetMinutes;
            await me.save();
        }

        const myLearning = Array.isArray(languageLearning) && languageLearning.length
            ? languageLearning
            : me.learningLanguages || [];
        const myTeaching = Array.isArray(languageTeaching) && languageTeaching.length
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
            .limit(40)
            .select('fullName username avatarUrl learningLanguages teachingLanguages language lastActive lastSeen subscriptionTier subscriptionExpires timezoneOffsetMinutes');

        if (candidates.length === 0) {
            return res.status(404).json({
                error: 'No matching partners found right now. Try again later.',
                hint: 'Check back once more users join your language combination.'
            });
        }

        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

        const myLimits = getUserLimits(me);
        const isPremiumMe = myLimits.voice || myLimits.video;
        const myTz = typeof me.timezoneOffsetMinutes === 'number'
            ? me.timezoneOffsetMinutes
            : (typeof timezoneOffsetMinutes === 'number' ? timezoneOffsetMinutes : null);

        const scored = candidates.map(c => {
            let score = 0;

            const sharedLearning = (c.teachingLanguages || []).filter(l => myLearning.includes(l));
            const sharedTeaching = (c.learningLanguages || []).filter(l => myTeaching.includes(l));
            score += (sharedLearning.length + sharedTeaching.length) * 10;

            if (c.language && c.language === me.language) score += 5;

            if (myTz != null && typeof c.timezoneOffsetMinutes === 'number') {
                const diff = Math.abs(c.timezoneOffsetMinutes - myTz);
                if (diff <= 60) score += 15;
                else if (diff <= 180) score += 8;
                else if (diff <= 360) score += 3;
            }

            const lastMs = c.lastActive ? new Date(c.lastActive).getTime()
                : (c.lastSeen ? new Date(c.lastSeen).getTime() : 0);
            if (lastMs > oneDayAgo) score += 10;
            else if (lastMs > sevenDaysAgo) score += 5;

            if (isPremiumMe && c.subscriptionTier !== 'free') {
                const stillActive = !c.subscriptionExpires || new Date(c.subscriptionExpires) > new Date();
                if (stillActive) score += 8;
            }

            return { candidate: c, score, sharedLearning, sharedTeaching };
        }).sort((a, b) => b.score - a.score);

        const best = scored[0];
        const target = best.candidate;

        const languageA = best.sharedLearning[0] || myLearning[0];
        const languageB = best.sharedTeaching[0] || myTeaching[0];

        // Effective flags = AND of both users
        const flags = computePairFlags(me, target);

        const pair = await Pair.create({
            userA: me._id,
            userB: target._id,
            languageA,
            languageB,
            status: 'active',
            ...flags,
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

        // Recompute flags on accept (in case a tier changed between request and accept)
        const userA = await User.findById(pair.userA);
        const userB = await User.findById(pair.userB);
        if (userA && userB) {
            const flags = computePairFlags(userA, userB);
            pair.voiceEnabled = flags.voiceEnabled;
            pair.videoEnabled = flags.videoEnabled;
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
 * POST /api/pairs/:pairId/call/start
 */
router.post('/:pairId/call/start', authenticateUser, async (req, res) => {
    const { pairId } = req.params;
    const { type } = req.body;

    if (!['voice', 'video'].includes(type)) {
        return res.status(400).json({ error: 'type must be "voice" or "video"' });
    }

    try {
        const pair = await Pair.findById(pairId);
        if (!pair) return res.status(404).json({ error: 'Pair not found' });

        if (pair.status !== 'active') {
            return res.status(400).json({ error: 'Pair is not active' });
        }

        if (pair.userA.toString() !== req.userId && pair.userB.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not part of this pair' });
        }

        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const limits = getUserLimits(user);

        if (type === 'voice' && !limits.voice) {
            return res.status(403).json({
                error: 'Voice calls require Premium or Immersive',
                currentTier: user.subscriptionTier,
                upgradeUrl: '/subscription'
            });
        }

        if (type === 'video' && !limits.video) {
            return res.status(403).json({
                error: 'Video calls require Immersive',
                currentTier: user.subscriptionTier,
                upgradeUrl: '/subscription'
            });
        }

        const partnerId = pair.userA.toString() === req.userId ? pair.userB : pair.userA;
        const partner = await User.findById(partnerId);
        if (!partner) return res.status(404).json({ error: 'Partner not found' });

        const partnerLimits = getUserLimits(partner);

        if (type === 'voice' && !partnerLimits.voice) {
            return res.status(403).json({
                error: 'Your partner does not have voice calls enabled on their tier'
            });
        }

        if (type === 'video' && !partnerLimits.video) {
            return res.status(403).json({
                error: 'Your partner does not have video calls enabled on their tier'
            });
        }

        res.json({
            success: true,
            type,
            pairId,
            partnerId,
            canStart: true
        });

    } catch (error) {
        console.error('Call start error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;