import express from 'express';
import Pair from '../models/Pair.js';
import PairMessage from '../models/PairMessage.js';
import ReadReceipt from '../models/ReadReceipt.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';
import { moderationMiddleware } from '../middleware/moderation.js';
import { canCreatePair, getUserLimits } from '../middleware/tierGate.js';

const router = express.Router();

/* ============================================================
   VOICE / VIDEO SLOT COUNTING
   Lives here (not in tierGate.js) so that the tier middleware has
   no runtime dependency on Pair — eliminates any chance of a
   circular import between Pair.js and tierGate.js.
   ============================================================ */

async function countVoicePairs(user) {
    return Pair.countDocuments({
        $or: [{ userA: user._id }, { userB: user._id }],
        status: 'active',
        voiceEnabled: true
    });
}

async function countVideoPairs(user) {
    return Pair.countDocuments({
        $or: [{ userA: user._id }, { userB: user._id }],
        status: 'active',
        videoEnabled: true
    });
}

/* ============================================================
   HELPERS
   ============================================================ */

function extractId(u) {
    if (!u) return null;
    if (typeof u === 'string') return u;
    if (u._id) return String(u._id);
    return String(u);
}

/**
 * Shape a Pair document for the frontend.
 */
function shapePair(pair, viewerId) {
    const obj = pair.toObject ? pair.toObject() : pair;
    const viewer = String(viewerId);

    const idA = extractId(obj.userA);
    const idB = extractId(obj.userB);

    if (idA === viewer) {
        obj.partner = obj.userB;
        obj.myRole = 'A';
    } else if (idB === viewer) {
        obj.partner = obj.userA;
        obj.myRole = 'B';
    } else {
        obj.partner = obj.userA;
        obj.myRole = null;
    }

    obj.partnerId = extractId(obj.partner);
    return obj;
}

/**
 * Compute effective voice/video flags for a pair.
 *
 * Both users must have the tier entitlement AND the requesting user
 * must have an available slot in their voice/video partner cap.
 *
 * Free: no voice, no video.
 * Premium: voice on up to 5 pairs.
 * Immersive: voice + video on unlimited pairs.
 */
async function computePairFlags(userA, userB, enableVoice = true, enableVideo = true) {
    const a = getUserLimits(userA);
    const b = getUserLimits(userB);

    let voiceEnabled = false;
    let videoEnabled = false;

    // ---- Voice ----
    if (enableVoice && a.voice && b.voice) {
        if (a.voicePairs === Infinity) {
            voiceEnabled = true;
        } else {
            const used = await countVoicePairs(userA);
            voiceEnabled = used < a.voicePairs;
        }
    }

    // ---- Video ----
    if (enableVideo && a.video && b.video) {
        if (a.videoPairs === Infinity) {
            videoEnabled = true;
        } else {
            const used = await countVideoPairs(userA);
            videoEnabled = used < a.videoPairs;
        }
    }

    return { voiceEnabled, videoEnabled };
}

/* ============================================================
   GET /api/pairs
   ============================================================ */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const pairs = await Pair.find({
            $or: [{ userA: req.userId }, { userB: req.userId }],
            status: { $in: ['pending', 'active'] }
        })
        .populate('userA', 'fullName username avatarUrl learningLanguages teachingLanguages language')
        .populate('userB', 'fullName username avatarUrl learningLanguages teachingLanguages language')
        .sort({ lastActivityAt: -1 });

        const shaped = pairs.map(p => shapePair(p, req.userId));

        res.json({
            data: shaped,
            items: shaped,
            pairs: shaped,
            total: shaped.length
        });
    } catch (error) {
        console.error('Get pairs error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/pairs/request
   Unlimited text pairs. Voice/video gated by tier + slots.
   ============================================================ */
router.post('/request', authenticateUser, async (req, res) => {
    const { targetUserId, userId, languageA, languageB, message } = req.body;

    let resolvedTargetId = targetUserId || userId;
    if (!resolvedTargetId) {
        return res.status(400).json({
            error: 'targetUserId (or userId) is required'
        });
    }

    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(resolvedTargetId))) {
            const byUsername = await User.findOne({
                username: String(resolvedTargetId).replace(/^@/, '').toLowerCase()
            });
            if (!byUsername) {
                return res.status(404).json({ error: 'No learner found with that username' });
            }
            resolvedTargetId = byUsername._id;
        }

        if (String(resolvedTargetId) === String(req.userId)) {
            return res.status(400).json({ error: 'Cannot pair with yourself' });
        }

        const user = await User.findById(req.userId);
        const target = await User.findById(resolvedTargetId);
        if (!target) return res.status(404).json({ error: 'Target user not found' });
        if (target.isBanned) return res.status(403).json({ error: 'Target user is unavailable' });

        const existing = await Pair.findOne({
            status: { $in: ['pending', 'active'] },
            $or: [
                { userA: req.userId, userB: resolvedTargetId },
                { userA: resolvedTargetId, userB: req.userId }
            ]
        });
        if (existing) return res.status(400).json({ error: 'Pair already exists' });

        let finalA = languageA;
        let finalB = languageB;

        if (!finalA || !finalB) {
            const myLearning = user.learningLanguages || [];
            const myTeaching = user.teachingLanguages || [];
            const theirLearning = target.learningLanguages || [];
            const theirTeaching = target.teachingLanguages || [];

            finalA = finalA
                || myLearning.find(l => theirTeaching.includes(l))
                || myLearning[0]
                || user.language
                || 'yoruba';

            finalB = finalB
                || myTeaching.find(l => theirLearning.includes(l))
                || myTeaching[0]
                || target.language
                || 'english';
        }

        const flags = await computePairFlags(user, target, true, true);

        const pair = await Pair.create({
            userA: req.userId,
            userB: resolvedTargetId,
            languageA: finalA,
            languageB: finalB,
            status: 'pending',
            ...flags
        });

        await Notification.create({
            userId: resolvedTargetId,
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

/* ============================================================
   POST /api/pairs/match
   Auto-match. Unlimited text pairs.
   ============================================================ */
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
            : (me.learningLanguages || []);
        const myTeaching = Array.isArray(languageTeaching) && languageTeaching.length
            ? languageTeaching
            : (me.teachingLanguages || []);

        if (myLearning.length === 0 && me.language) myLearning.push(me.language);
        if (myTeaching.length === 0 && me.language) myTeaching.push(me.language);

        if (myLearning.length === 0 || myTeaching.length === 0) {
            return res.status(400).json({
                error: 'Set learningLanguages and teachingLanguages on your profile first'
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
            $or: [
                {
                    teachingLanguages: { $in: myLearning },
                    learningLanguages: { $in: myTeaching }
                },
                { teachingLanguages: { $in: myLearning } },
                { learningLanguages: { $in: myTeaching } }
            ]
        })
            .limit(40)
            .select('fullName username avatarUrl learningLanguages teachingLanguages language lastActive lastSeen subscriptionTier subscriptionExpires timezoneOffsetMinutes');

        if (candidates.length === 0) {
            return res.status(404).json({
                error: 'No matching partners found right now. Try again later.',
                hint: 'Add more learning and teaching languages to widen your matches.'
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

            if (sharedLearning.length && sharedTeaching.length) score += 30;
            score += (sharedLearning.length + sharedTeaching.length) * 8;

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

        const flags = await computePairFlags(me, target, true, true);

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

/* ============================================================
   POST /api/pairs/:pairId/accept
   ============================================================ */
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

        const userA = await User.findById(pair.userA);
        const userB = await User.findById(pair.userB);
        if (userA && userB) {
            const flags = await computePairFlags(userA, userB, true, true);
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

/* ============================================================
   DELETE /api/pairs/:pairId
   ============================================================ */
router.delete('/:pairId', authenticateUser, async (req, res) => {
    const { pairId } = req.params;
    const { reason } = req.body || {};

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

/* ============================================================
   GET /api/pairs/:pairId/messages
   ============================================================ */
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

        const ordered = messages.reverse();

        const shapedMessages = ordered.map(m => {
            const obj = m.toObject ? m.toObject() : m;
            obj.isMine = obj.senderId && obj.senderId.toString() === req.userId;
            return obj;
        });

        res.json({
            data: shapedMessages,
            items: shapedMessages,
            messages: shapedMessages,
            page,
            limit
        });
    } catch (error) {
        console.error('Get pair messages error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/pairs/:pairId/read
   ============================================================ */
router.post('/:pairId/read', authenticateUser, async (req, res) => {
    const { pairId } = req.params;

    try {
        const pair = await Pair.findById(pairId);
        if (!pair) return res.status(404).json({ error: 'Pair not found' });

        if (pair.userA.toString() !== req.userId && pair.userB.toString() !== req.userId) {
            return res.status(403).json({ error: 'Not part of this pair' });
        }

        const receipt = await ReadReceipt.findOneAndUpdate(
            { userId: req.userId, contextType: 'pair', contextId: pairId },
            { lastReadAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, lastReadAt: receipt.lastReadAt });
    } catch (error) {
        console.error('Mark pair read error:', error);
        res.status(400).json({ error: error.message });
    }
});


/* ============================================================
   POST /api/pairs/:pairId/messages
   ============================================================ */
router.post('/:pairId/messages', authenticateUser, moderationMiddleware, async (req, res) => {
    const { pairId } = req.params;
    const { text, content } = req.body;

    const messageText = text || content;
    if (!messageText) {
        return res.status(400).json({ error: 'text (or content) is required' });
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

        const message = await PairMessage.create({
            pairId,
            senderId: req.userId,
            text: messageText
        });

        pair.lastActivityAt = new Date();
        await pair.save();

        const obj = message.toObject();
        obj.isMine = true;

        res.status(201).json(obj);
    } catch (error) {
        console.error('Send pair message error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/pairs/:pairId/call/start
   Session gate for voice/video calls.
   Checks:
     1. Both users' tier entitlement (voice: Premium+, video: Immersive)
     2. The caller's voice/video slot cap
   ============================================================ */
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

        const partnerId = pair.userA.toString() === req.userId ? pair.userB : pair.userA;
        const partner = await User.findById(partnerId);
        if (!partner) return res.status(404).json({ error: 'Partner not found' });

        const userLimits = getUserLimits(user);
        const partnerLimits = getUserLimits(partner);

        // ---------------- VOICE ----------------
        if (type === 'voice') {
            if (!userLimits.voice) {
                return res.status(403).json({
                    error: 'Voice calls require Premium or Immersive',
                    currentTier: user.subscriptionTier,
                    upgradeUrl: '/subscription',
                    feature: 'voice_call'
                });
            }
            if (!partnerLimits.voice) {
                return res.status(403).json({
                    error: 'Your partner does not have voice calls enabled on their tier'
                });
            }
            if (userLimits.voicePairs !== Infinity) {
                const used = await countVoicePairs(user);
                if (used >= userLimits.voicePairs && !pair.voiceEnabled) {
                    return res.status(403).json({
                        error: `You're already using voice calls with ${userLimits.voicePairs} partners. End one to start a new voice call.`,
                        currentTier: user.subscriptionTier,
                        voicePairsUsed: used,
                        voicePairsLimit: userLimits.voicePairs,
                        upgradeUrl: '/subscription',
                        feature: 'voice_pairs'
                    });
                }
            }
        }

        // ---------------- VIDEO ----------------
        if (type === 'video') {
            if (!userLimits.video) {
                return res.status(403).json({
                    error: 'Video calls require Immersive',
                    currentTier: user.subscriptionTier,
                    upgradeUrl: '/subscription',
                    feature: 'video_call'
                });
            }
            if (!partnerLimits.video) {
                return res.status(403).json({
                    error: 'Your partner does not have video calls enabled on their tier'
                });
            }
            if (userLimits.videoPairs !== Infinity) {
                const used = await countVideoPairs(user);
                if (used >= userLimits.videoPairs && !pair.videoEnabled) {
                    return res.status(403).json({
                        error: `You're already using video calls with ${userLimits.videoPairs} partners.`,
                        currentTier: user.subscriptionTier,
                        videoPairsUsed: used,
                        videoPairsLimit: userLimits.videoPairs,
                        upgradeUrl: '/subscription',
                        feature: 'video_pairs'
                    });
                }
            }
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