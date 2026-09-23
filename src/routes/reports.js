import express from 'express';
import Report from '../models/Report.js';
import Pair from '../models/Pair.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

const AUTO_BAN_THRESHOLD = 3;

/**
 * POST /api/reports
 * Report a user, message, or pair
 */
router.post('/', authenticateUser, async (req, res) => {
    const { targetType, targetId, targetUserId, reason, description } = req.body;

    if (!targetType || !targetId || !targetUserId || !reason) {
        return res.status(400).json({ error: 'targetType, targetId, targetUserId, reason are required' });
    }

    try {
        const report = await Report.create({
            reporterId: req.userId,
            targetType,
            targetId,
            targetUserId,
            reason,
            description: description || ''
        });

        // If reporting a pair, auto-end it
        if (targetType === 'pair' || targetType === 'pair_message') {
            const pair = await Pair.findById(targetId.toString() === targetType ? targetId : req.body.pairId);
            if (pair && pair.status === 'active') {
                pair.status = 'ended';
                pair.endReason = 'report';
                pair.endedAt = new Date();
                pair.endedBy = req.userId;
                await pair.save();

                await User.findByIdAndUpdate(pair.userA, { $inc: { activePairs: -1 } });
                await User.findByIdAndUpdate(pair.userB, { $inc: { activePairs: -1 } });
            }
        }

        // Increment target user's report count
        const targetUser = await User.findByIdAndUpdate(
            targetUserId,
            { $inc: { reportCount: 1 } },
            { new: true }
        );

        // Auto-ban if threshold reached
        if (targetUser && targetUser.reportCount >= AUTO_BAN_THRESHOLD) {
            targetUser.isBanned = true;
            targetUser.isActive = false;
            await targetUser.save();
        }

        res.status(201).json({ success: true, report });
    } catch (error) {
        console.error('Create report error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/reports/mine
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