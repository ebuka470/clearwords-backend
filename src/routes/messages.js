import express from 'express';
import PodMessage from '../models/PodMessage.js';
import ReadReceipt from '../models/ReadReceipt.js';
import PairMessage from '../models/PairMessage.js';
import Pod from '../models/Pod.js';
import Pair from '../models/Pair.js';
import { authenticateUser } from '../middleware/auth.js';
import { resolveProfile } from '../middleware/profile.js'; // <-- ADD THIS

const router = express.Router();

// GET /api/messages/unread
router.get('/unread', authenticateUser, resolveProfile, async (req, res) => { // <-- ADD resolveProfile
    try {
        const profileScope = req.profileId ? { profileId: req.profileId } : { $or: [{ profileId: null }, { profileId: { $exists: false } }] };

        // 1. Get user's active pods
        const pods = await Pod.find({ 'members.userId': req.userId, isActive: true }).select('_id');
        const podIds = pods.map(p => p._id);

        let podUnread = {};
        let podTotal = 0;

        if (podIds.length > 0) {
            // Get receipts for this profile
            const podReceipts = await ReadReceipt.find({
                userId: req.userId,
                contextType: 'pod',
                contextId: { $in: podIds }
            });
            const receiptMap = Object.fromEntries(podReceipts.map(r => [String(r.contextId), r.lastReadAt]));

            // Count unread per pod
            for (const podId of podIds) {
                const lastRead = receiptMap[String(podId)] || new Date(0);
                const count = await PodMessage.countDocuments({
                    podId,
                    ...profileScope, // Filter messages by profile
                    createdAt: { $gt: lastRead },
                    authorId: { $ne: req.userId },
                    isDeleted: false
                });
                if (count > 0) {
                    podUnread[String(podId)] = count;
                    podTotal += count;
                }
            }
        }

        // 2. Get user's active pairs
        const pairs = await Pair.find({ 
            $or: [
                { userA: req.userId, ...(req.profileId ? { profileIdA: req.profileId } : { profileIdA: null }) },
                { userB: req.userId, ...(req.profileId ? { profileIdB: req.profileId } : { profileIdB: null }) }
            ],
            status: 'active' 
        }).select('_id');
        
        const pairIds = pairs.map(p => p._id);

        let pairUnread = {};
        let pairTotal = 0;

        if (pairIds.length > 0) {
            const pairReceipts = await ReadReceipt.find({
                userId: req.userId,
                contextType: 'pair',
                contextId: { $in: pairIds }
            });
            const receiptMap = Object.fromEntries(pairReceipts.map(r => [String(r.contextId), r.lastReadAt]));

            for (const pairId of pairIds) {
                const lastRead = receiptMap[String(pairId)] || new Date(0);
                const count = await PairMessage.countDocuments({
                    pairId,
                    ...profileScope,
                    createdAt: { $gt: lastRead },
                    senderId: { $ne: req.userId },
                    isDeleted: false
                });
                if (count > 0) {
                    pairUnread[String(pairId)] = count;
                    pairTotal += count;
                }
            }
        }

        res.json({
            pods: podUnread,
            pairs: pairUnread,
            total: podTotal + pairTotal
        });

    } catch (error) {
        console.error('Unread counts error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;