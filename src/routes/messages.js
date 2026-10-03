import express from 'express';
import mongoose from 'mongoose';
import Pod from '../models/Pod.js';
import PodMessage from '../models/PodMessage.js';
import Pair from '../models/Pair.js';
import PairMessage from '../models/PairMessage.js';
import ReadReceipt from '../models/ReadReceipt.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

/* ============================================================
   GET /api/messages/unread
   Returns unread counts per pod and per pair for the current user.
   ============================================================ */
router.get('/unread', authenticateUser, async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.userId);

        const [pods, pairs, receipts] = await Promise.all([
            Pod.find({ 'members.userId': userId, isActive: true }).select('_id'),
            Pair.find({
                $or: [{ userA: userId }, { userB: userId }],
                status: 'active'
            }).select('_id'),
            ReadReceipt.find({ userId })
        ]);

        const podIds = pods.map(p => p._id);
        const pairIds = pairs.map(p => p._id);

        const receiptMap = {};
        receipts.forEach(r => {
            receiptMap[`${r.contextType}:${r.contextId.toString()}`] = r.lastReadAt;
        });

        const podUnread = {};
        let totalPodUnread = 0;

        if (podIds.length) {
            const podAgg = await PodMessage.aggregate([
                {
                    $match: {
                        podId: { $in: podIds },
                        isDeleted: false,
                        authorId: { $ne: userId }
                    }
                },
                {
                    $group: {
                        _id: '$podId',
                        createdAtList: { $push: '$createdAt' }
                    }
                }
            ]);

            podAgg.forEach(group => {
                const podIdStr = group._id.toString();
                const lastRead = receiptMap[`pod:${podIdStr}`] || new Date(0);
                const count = group.createdAtList.filter(d => d > lastRead).length;
                if (count > 0) {
                    podUnread[podIdStr] = count;
                    totalPodUnread += count;
                }
            });
        }

        const pairUnread = {};
        let totalPairUnread = 0;

        if (pairIds.length) {
            const pairAgg = await PairMessage.aggregate([
                {
                    $match: {
                        pairId: { $in: pairIds },
                        isDeleted: false,
                        senderId: { $ne: userId }
                    }
                },
                {
                    $group: {
                        _id: '$pairId',
                        createdAtList: { $push: '$createdAt' }
                    }
                }
            ]);

            pairAgg.forEach(group => {
                const pairIdStr = group._id.toString();
                const lastRead = receiptMap[`pair:${pairIdStr}`] || new Date(0);
                const count = group.createdAtList.filter(d => d > lastRead).length;
                if (count > 0) {
                    pairUnread[pairIdStr] = count;
                    totalPairUnread += count;
                }
            });
        }

        res.json({
            pods: podUnread,
            pairs: pairUnread,
            total: totalPodUnread + totalPairUnread
        });
    } catch (error) {
        console.error('Unread count error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;