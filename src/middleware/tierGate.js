import User from '../models/User.js';
import Pod from '../models/Pod.js';

/* ============================================================
   TIER LIMITS
   ============================================================ */
export const TIER_LIMITS = {
    free: {
        pairs: Infinity,
        voicePairs: 0,
        videoPairs: 0,
        pods: 3,
        canCreatePod: false,
        voice: false,
        video: false,
        customLessonsPerDay: 5,
        lessonsPerLanguage: 50
    },
    premium: {
        pairs: Infinity,
        voicePairs: 5,
        videoPairs: 0,
        pods: 3,
        canCreatePod: true,
        voice: true,
        video: false,
        customLessonsPerDay: Infinity,
        lessonsPerLanguage: Infinity
    },
    immersive: {
        pairs: Infinity,
        voicePairs: Infinity,
        videoPairs: Infinity,
        pods: 3,
        canCreatePod: true,
        voice: true,
        video: true,
        customLessonsPerDay: Infinity,
        lessonsPerLanguage: Infinity
    }
};

/* ============================================================
   AI CHAT LIMITS (used by routes/ai.js + routes/subscription.js)
   ============================================================ */
export const CHAT_LIMITS = {
    free: 200,
    premium: Infinity,
    immersive: Infinity
};

/* ============================================================
   TTS AUDIO LIMITS (used by routes/tts.js + routes/subscription.js)
   ============================================================ */
export const TTS_LIMITS = {
    free: 30,
    premium: 300,
    immersive: Infinity
};

/* ============================================================
   BASIC RESOLVERS
   ============================================================ */
export function getUserLimits(user) {
    if (user.subscriptionExpires && new Date(user.subscriptionExpires) < new Date()) {
        return TIER_LIMITS.free;
    }
    return TIER_LIMITS[user.subscriptionTier] || TIER_LIMITS.free;
}

/* ============================================================
   TEXT PAIRS — unlimited on every tier
   ============================================================ */
export async function canCreatePair(_user) {
    return true;
}

/* ============================================================
   PODS
   ============================================================ */
export async function canJoinPod(user) {
    const limits = getUserLimits(user);
    const joinedCount = await Pod.countDocuments({
        'members.userId': user._id,
        isActive: true
    });
    return joinedCount < limits.pods;
}

/* ============================================================
   GENERIC FEATURE GATE
   ============================================================ */
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