import express from 'express';
import Report from '../models/Report.js';
import Pair from '../models/Pair.js';
import PairMessage from '../models/PairMessage.js';
import PodMessage from '../models/PodMessage.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

const AUTO_BAN_THRESHOLD = 3;

/**
 * POST /api/reports
 * Report a user, message, or pair.
 *
 * Accepts { targetType, targetId, reason, description | details, evidence }.
 * Resolves the reported user automatically when only a target ID is given.
 */
router.post('/', authenticateUser, async (req, res) => {
    const {
        targetType,
        targetId,
        targetUserId,
        reason,
        description,
        details,
        evidence
    } = req.body;

    if (!targetType || !targetId || !reason) {
        return res.status(400).json({
            error: 'targetType, targetId, reason are required'
        });
    }

    const resolvedDescription = description || details || '';
    const validTargetTypes = ['user', 'pair', 'pair_message', 'pod_message'];
    if (!validTargetTypes.includes(targetType)) {
        return res.status(400).json({
            error: `targetType must be one of: ${validTargetTypes.join(', ')}`
        });
    }

    try {
        // ---- Resolve targetUserId when not provided ----
        let resolvedTargetUserId = targetUserId;

        if (!resolvedTargetUserId && targetType === 'pair') {
            const pair = await Pair.findById(targetId);
            if (pair) {
                const other = pair.userA.toString() === req.userId
                    ? pair.userB
                    : pair.userA;
                resolvedTargetUserId = other;
            }
        }

        if (!resolvedTargetUserId && targetType === 'pair_message') {
            const msg = await PairMessage.findById(targetId);
            if (msg) {
                resolvedTargetUserId = msg.senderId;
                // Also grab the pair so we can auto-end it below
                if (!resolvedTargetUserId) {
                    resolvedTargetUserId = msg.senderId;
                }
            }
        }

        if (!resolvedTargetUserId && targetType === 'pod_message') {
            const msg = await PodMessage.findById(targetId);
            if (msg) resolvedTargetUserId = msg.authorId;
        }

        if (!resolvedTargetUserId) {
            return res.status(400).json({
                error: 'Could not resolve the reported user for this target'
            });
        }

        // Prevent self-reports
        if (String(resolvedTargetUserId) === String(req.userId)) {
            return res.status(400).json({ error: 'You cannot report yourself' });
        }

        // ---- Create the report ----
        const report = await Report.create({
            reporterId: req.userId,
            targetType,
            targetId,
            targetUserId: resolvedTargetUserId,
            reason,
            description: resolvedDescription,
            evidence: evidence || ''
        });

        // ---- Auto-end the pair if this was a pair or pair-message report ----
        if (targetType === 'pair' || targetType === 'pair_message') {
            let pairToEnd = null;

            if (targetType === 'pair') {
                pairToEnd = await Pair.findById(targetId);
            } else if (targetType === 'pair_message') {
                const msg = await PairMessage.findById(targetId);
                if (msg) pairToEnd = await Pair.findById(msg.pairId);
            }

            if (pairToEnd && pairToEnd.status === 'active') {
                pairToEnd.status = 'ended';
                pairToEnd.endReason = 'report';
                pairToEnd.endedAt = new Date();
                pairToEnd.endedBy = req.userId;
                await pairToEnd.save();

                await User.findByIdAndUpdate(pairToEnd.userA, { $inc: { activePairs: -1 } });
                await User.findByIdAndUpdate(pairToEnd.userB, { $inc: { activePairs: -1 } });
            }
        }

        // ---- Increment target user's report count ----
        const targetUser = await User.findByIdAndUpdate(
            resolvedTargetUserId,
            { $inc: { reportCount: 1 } },
            { new: true }
        );

        // ---- Auto-ban when threshold reached ----
        if (targetUser && targetUser.reportCount >= AUTO_BAN_THRESHOLD) {
            targetUser.isBanned = true;
            targetUser.isActive = false;
            await targetUser.save();

            await Notification.create({
                userId: resolvedTargetUserId,
                type: 'report_resolved',
                content: 'Your account has been suspended after multiple reports.'
            });
        }

        res.status(201).json({ success: true, report });

    } catch (error) {
        console.error('Create report error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/reports/mine
 * List reports filed by the current user.
 */
router.get('/mine', authenticateUser, async (req, res) => {
    try {
        const reports = await Report.find({ reporterId: req.userId })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json({ data: reports });
    } catch (error) {
        console.error('Get reports error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;