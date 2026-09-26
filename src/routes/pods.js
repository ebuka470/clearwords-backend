import express from 'express';
import Pod from '../models/Pod.js';
import PodMessage from '../models/PodMessage.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';
import { moderationMiddleware } from '../middleware/moderation.js';
import { canJoinPod, getUserLimits } from '../middleware/tierGate.js';

const router = express.Router();

/**
 * GET /api/pods
 */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const pods = await Pod.find({
            'members.userId': req.userId,
            isActive: true
        }).sort({ updatedAt: -1 });

        res.json({ data: pods, total: pods.length });
    } catch (error) {
        console.error('Get pods error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pods
 * Create a pod (Premium/Immersive only)
 */
router.post('/', authenticateUser, async (req, res) => {
    const { name, description, language, level, timezone } = req.body;

    if (!name || !language || !level) {
        return res.status(400).json({ error: 'name, language, and level are required' });
    }

    try {
        const user = await User.findById(req.userId);
        const limits = getUserLimits(user);

        if (!limits.canCreatePod) {
            return res.status(403).json({
                error: 'Pod creation requires Premium or Immersive tier',
                currentTier: user.subscriptionTier
            });
        }

        const pod = await Pod.create({
            name,
            description: description || '',
            language,
            level,
            timezone: timezone || 'Africa/Lagos',
            creatorId: user._id,
            members: [{ userId: user._id, role: 'leader' }]
        });

        user.podsJoined = (user.podsJoined || 0) + 1;
        await user.save();

        res.status(201).json(pod);
    } catch (error) {
        console.error('Create pod error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pods/match
 */
router.post('/match', authenticateUser, async (req, res) => {
    const { language, level, timezone } = req.body;

    if (!language || !level) {
        return res.status(400).json({ error: 'language and level are required' });
    }

    try {
        const user = await User.findById(req.userId);

        const canJoin = await canJoinPod(user);
        if (!canJoin) {
            return res.status(403).json({
                error: 'Pod limit reached for your tier',
                currentTier: user.subscriptionTier
            });
        }

        const alreadyIn = await Pod.findOne({
            language,
            isActive: true,
            'members.userId': user._id
        });
        if (alreadyIn) {
            return res.json({ matched: false, pod: alreadyIn, reason: 'already_in_pod' });
        }

        const candidatePod = await Pod.findOneAndUpdate(
            {
                language,
                level,
                timezone: timezone || 'Africa/Lagos',
                isActive: true,
                isAutoMatched: true,
                $expr: { $lt: [{ $size: '$members' }, '$maxMembers'] }
            },
            {
                $push: { members: { userId: user._id, role: 'member' } }
            },
            { new: true, sort: { createdAt: 1 } }
        );

        if (candidatePod) {
            user.podsJoined = (user.podsJoined || 0) + 1;
            await user.save();

            await Notification.create({
                userId: user._id,
                type: 'pod_milestone',
                podId: candidatePod._id,
                content: `You were matched into "${candidatePod.name}"`
            });

            return res.json({ matched: true, pod: candidatePod, created: false });
        }

        const newPod = await Pod.create({
            name: `${language} ${level} pod`,
            description: 'Auto-generated pod',
            language,
            level,
            timezone: timezone || 'Africa/Lagos',
            creatorId: user._id,
            isAutoMatched: true,
            members: [{ userId: user._id, role: 'leader' }]
        });

        user.podsJoined = (user.podsJoined || 0) + 1;
        await user.save();

        res.status(201).json({ matched: true, pod: newPod, created: true });
    } catch (error) {
        console.error('Pod match error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pods/:podId/join
 * Enforces language match, tier limit, and 24h rejoin cooldown
 */
router.post('/:podId/join', authenticateUser, async (req, res) => {
    const { podId } = req.params;
    const { inviteCode } = req.body;

    try {
        const pod = await Pod.findById(podId);
        if (!pod || !pod.isActive) {
            return res.status(404).json({ error: 'Pod not found' });
        }

        if (inviteCode && pod.inviteCode !== inviteCode) {
            return res.status(403).json({ error: 'Invalid invite code' });
        }

        if (pod.members.length >= pod.maxMembers) {
            return res.status(400).json({ error: 'Pod is full' });
        }

        if (pod.members.some(m => m.userId.toString() === req.userId)) {
            return res.status(400).json({ error: 'Already a member' });
        }

        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

        // 24h rejoin cooldown
        const recentLeave = (pod.formerMembers || []).find(
            fm => fm.userId && fm.userId.toString() === req.userId
                && Date.now() - new Date(fm.leftAt).getTime() < 24 * 60 * 60 * 1000
        );
        if (recentLeave) {
            return res.status(429).json({
                error: 'You recently left this pod. Try rejoining in a few hours.'
            });
        }

        // Language check
        const isLearning = (user.learningLanguages || []).includes(pod.language);
        const isTeaching = (user.teachingLanguages || []).includes(pod.language);
        const isPrimary = user.language === pod.language;

        if (!isLearning && !isTeaching && !isPrimary) {
            return res.status(400).json({
                error: `This pod is for ${pod.language} learners. Update your languages to join.`
            });
        }

        // Tier limit
        const canJoin = await canJoinPod(user);
        if (!canJoin) {
            return res.status(403).json({
                error: 'Pod limit reached for your tier',
                currentTier: user.subscriptionTier
            });
        }

        pod.members.push({ userId: user._id, role: 'member' });
        pod.formerMembers = (pod.formerMembers || []).filter(
            fm => !fm.userId || fm.userId.toString() !== req.userId
        );
        await pod.save();

        user.podsJoined = (user.podsJoined || 0) + 1;
        await user.save();

        const leader = pod.members.find(m => m.role === 'leader');
        if (leader && leader.userId.toString() !== req.userId) {
            await Notification.create({
                userId: leader.userId,
                type: 'pod_milestone',
                sourceId: user._id,
                sourceUsername: user.username || 'User',
                sourceAvatar: user.avatarUrl || '',
                podId: pod._id,
                content: `${user.fullName || 'Someone'} joined your pod "${pod.name}"`
            });
        }

        res.json({ success: true, pod });
    } catch (error) {
        console.error('Join pod error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/pods/:podId/leave
 */
router.delete('/:podId/leave', authenticateUser, async (req, res) => {
    const { podId } = req.params;

    try {
        const pod = await Pod.findById(podId);
        if (!pod) return res.status(404).json({ error: 'Pod not found' });

        const isMember = pod.members.some(m => m.userId.toString() === req.userId);
        if (!isMember) {
            return res.status(400).json({ error: 'Not a member of this pod' });
        }

        pod.formerMembers = pod.formerMembers || [];
        pod.formerMembers.push({ userId: req.userId, leftAt: new Date() });

        pod.members = pod.members.filter(m => m.userId.toString() !== req.userId);

        if (pod.members.length === 0) {
            pod.isActive = false;
        }

        await pod.save();

        await User.findByIdAndUpdate(req.userId, { $inc: { podsJoined: -1 } });

        res.json({ success: true });
    } catch (error) {
        console.error('Leave pod error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/pods/:podId/messages
 */
router.get('/:podId/messages', authenticateUser, async (req, res) => {
    const { podId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    try {
        const pod = await Pod.findById(podId);
        if (!pod) return res.status(404).json({ error: 'Pod not found' });

        if (!pod.members.some(m => m.userId.toString() === req.userId)) {
            return res.status(403).json({ error: 'Not a member of this pod' });
        }

        const skip = (page - 1) * limit;
        const messages = await PodMessage.find({ podId, isDeleted: false })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({ data: messages.reverse(), page, limit });
    } catch (error) {
        console.error('Get pod messages error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pods/:podId/messages
 */
router.post('/:podId/messages', authenticateUser, moderationMiddleware, async (req, res) => {
    const { podId } = req.params;
    const { text } = req.body;

    if (!text) return res.status(400).json({ error: 'text is required' });

    try {
        const pod = await Pod.findById(podId);
        if (!pod) return res.status(404).json({ error: 'Pod not found' });

        if (!pod.members.some(m => m.userId.toString() === req.userId)) {
            return res.status(403).json({ error: 'Not a member of this pod' });
        }

        const user = await User.findById(req.userId);

        const message = await PodMessage.create({
            podId,
            authorId: user._id,
            authorUsername: user.username || user.email.split('@')[0],
            authorAvatar: user.avatarUrl || '',
            text,
            type: 'text'
        });

        pod.updatedAt = new Date();
        await pod.save();

        res.status(201).json(message);
    } catch (error) {
        console.error('Send pod message error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/pods/:podId/checkin
 */
router.post('/:podId/checkin', authenticateUser, async (req, res) => {
    const { podId } = req.params;
    const { lessonsCompleted } = req.body;

    if (typeof lessonsCompleted !== 'number' || lessonsCompleted < 0) {
        return res.status(400).json({ error: 'lessonsCompleted must be a non-negative number' });
    }

    try {
        const pod = await Pod.findById(podId);
        if (!pod || !pod.isActive) return res.status(404).json({ error: 'Pod not found' });

        if (!pod.members.some(m => m.userId.toString() === req.userId)) {
            return res.status(403).json({ error: 'Not a member of this pod' });
        }

        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const existing = await PodMessage.findOne({
            podId,
            authorId: req.userId,
            type: 'checkin',
            createdAt: { $gte: startOfWeek }
        });

        if (existing) {
            return res.status(400).json({ error: 'You already checked in this week' });
        }

        const user = await User.findById(req.userId);

        const checkin = await PodMessage.create({
            podId,
            authorId: req.userId,
            authorUsername: user.username || user.email.split('@')[0],
            authorAvatar: user.avatarUrl || '',
            text: `✅ Checked in: ${lessonsCompleted} lesson${lessonsCompleted === 1 ? '' : 's'} this week`,
            type: 'checkin'
        });

        const distinctCheckins = await PodMessage.distinct('authorId', {
            podId,
            type: 'checkin',
            createdAt: { $gte: startOfWeek }
        });

        const majorityCheckedIn = distinctCheckins.length >= Math.ceil(pod.members.length / 2);

        if (majorityCheckedIn && (!pod.lastStreakCheck || pod.lastStreakCheck < startOfWeek)) {
            pod.sharedStreak += 1;
            pod.lastStreakCheck = now;

            const notifications = pod.members.map(m => ({
                userId: m.userId,
                type: 'streak_bonus',
                podId: pod._id,
                content: `🔥 Your pod hit the weekly goal! Shared streak: ${pod.sharedStreak}`
            }));
            await Notification.insertMany(notifications);
        }

        pod.weeklyXP += lessonsCompleted;
        pod.totalXP += lessonsCompleted;
        await pod.save();

        res.status(201).json({
            success: true,
            checkin,
            sharedStreak: pod.sharedStreak,
            weeklyXP: pod.weeklyXP
        });
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/pods/:podId/leaderboard
 */
router.get('/:podId/leaderboard', authenticateUser, async (req, res) => {
    const { podId } = req.params;

    try {
        const pod = await Pod.findById(podId).populate(
            'members.userId',
            'fullName username avatarUrl subscriptionTier'
        );

        if (!pod) return res.status(404).json({ error: 'Pod not found' });

        if (!pod.members.some(m => m.userId._id.toString() === req.userId)) {
            return res.status(403).json({ error: 'Not a member of this pod' });
        }

        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const memberXP = await PodMessage.aggregate([
            {
                $match: {
                    podId: pod._id,
                    type: 'checkin',
                    createdAt: { $gte: startOfWeek }
                }
            },
            {
                $group: {
                    _id: '$authorId',
                    lessons: { $sum: { $toInt: { $arrayElemAt: [{ $split: ['$text', ': '] }, 1] } } },
                    checkins: { $sum: 1 }
                }
            }
        ]);

        const xpMap = Object.fromEntries(memberXP.map(m => [m._id.toString(), m.lessons || 0]));

        const memberLeaderboard = pod.members.map(m => ({
            userId: m.userId._id,
            fullName: m.userId.fullName,
            username: m.userId.username,
            avatarUrl: m.userId.avatarUrl,
            role: m.role,
            weeklyXP: xpMap[m.userId._id.toString()] || 0
        })).sort((a, b) => b.weeklyXP - a.weeklyXP);

        const podRanking = await Pod.aggregate([
            { $match: { language: pod.language, isActive: true } },
            {
                $project: {
                    name: 1,
                    language: 1,
                    level: 1,
                    weeklyXP: 1,
                    memberCount: { $size: '$members' }
                }
            },
            { $sort: { weeklyXP: -1 } },
            { $limit: 20 }
        ]);

        const podRank = podRanking.findIndex(p => p._id.toString() === pod._id.toString()) + 1;

        res.json({
            pod: {
                id: pod._id,
                name: pod.name,
                sharedStreak: pod.sharedStreak,
                weeklyXP: pod.weeklyXP,
                totalXP: pod.totalXP,
                rank: podRank || null
            },
            members: memberLeaderboard,
            topPods: podRanking
        });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;