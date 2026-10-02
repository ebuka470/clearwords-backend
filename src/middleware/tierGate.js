import User from '../models/User.js';
import Pod from '../models/Pod.js';

/* ============================================================
   TIER LIMITS
   Text pairing is unlimited on every tier. Voice and video are
   the gate — those have real infrastructure cost and clear
   upgrade value.

   Per-tier voice/video semantics:
     voice: false           → cannot start voice calls at all
     voicePairs: 0          → irrelevant when voice is false
     voicePairs: 5          → can have voice enabled on up to 5 pairs
     voicePairs: Infinity   → no cap on voice-enabled pairs
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

/**
 * Text pairs are unlimited. Always returns true unless a lower-level
 * guard triggers elsewhere. Kept as a function so callers don't
 * change if we later add a safety cap.
 */
export async function canCreatePair(_user) {
    return true;
}

/**
 * Voice/video slot counting lives in `routes/pairs.js`, not here.
 * This module has no dependency on Pair's runtime — that keeps
 * `Pair.js → tierGate.js → Pair.js` cycles from forming.
 */

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