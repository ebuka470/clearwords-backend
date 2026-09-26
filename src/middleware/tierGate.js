import User from '../models/User.js';
import Pair from '../models/Pair.js';
import Pod from '../models/Pod.js';

export const TIER_LIMITS = {
    free: {
        pairs: 1,
        pods: 3,
        canCreatePod: false,
        voice: false,
        video: false,
        customLessonsPerDay: 5,
        lessonsPerLanguage: 50
    },
    premium: {
        pairs: 5,
        pods: 3,
        canCreatePod: true,
        voice: true,
        video: false,
        customLessonsPerDay: Infinity,
        lessonsPerLanguage: Infinity
    },
    immersive: {
        pairs: Infinity,
        pods: 3,
        canCreatePod: true,
        voice: true,
        video: true,
        customLessonsPerDay: Infinity,
        lessonsPerLanguage: Infinity
    }
};

// AI chat daily limits
export const CHAT_LIMITS = {
    free: 200,
    premium: Infinity,
    immersive: Infinity
};

// TTS audio daily limits
export const TTS_LIMITS = {
    free: 30,
    premium: 300,
    immersive: Infinity
};

export function getUserLimits(user) {
    if (user.subscriptionExpires && new Date(user.subscriptionExpires) < new Date()) {
        return TIER_LIMITS.free;
    }
    return TIER_LIMITS[user.subscriptionTier] || TIER_LIMITS.free;
}

export async function canCreatePair(user) {
    const limits = getUserLimits(user);
    const activeCount = await Pair.countDocuments({
        $or: [{ userA: user._id }, { userB: user._id }],
        status: 'active'
    });
    return activeCount < limits.pairs;
}

export async function canJoinPod(user) {
    const limits = getUserLimits(user);
    const joinedCount = await Pod.countDocuments({
        'members.userId': user._id,
        isActive: true
    });
    return joinedCount < limits.pods;
}

export function requireFeature(feature) {
    return async (req, res, next) => {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const limits = getUserLimits(user);
        if (!limits[feature]) {
            return res.status(403).json({
                error: `${feature} requires a higher subscription tier`,
                currentTier: user.subscriptionTier,
                feature
            });
        }
        req.userLimits = limits;
        next();
    };
}