import mongoose from 'mongoose';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import LessonCompletion from '../models/LessonCompletion.js';
import StreakFreeze from '../models/StreakFreeze.js';
import TimmyChat from '../models/TimmyChat.js';
import ProgressCard from '../models/ProgressCard.js';
import Pair from '../models/Pair.js';
import PairMessage from '../models/PairMessage.js';
import Pod from '../models/Pod.js';
import PodMessage from '../models/PodMessage.js';
import Referral from '../models/Referral.js';
import Notification from '../models/Notification.js';
import UsageCounter from '../models/UsageCounter.js';

export const FAMILY_TIERS = ['premium', 'immersive'];

export function isFamilyEligible(user) {
    if (!user) return false;
    if (!FAMILY_TIERS.includes(user.subscriptionTier)) return false;
    if (user.subscriptionExpires && new Date(user.subscriptionExpires) < new Date()) {
        return false;
    }
    return true;
}

export async function migratePersonalUserToFamily(userId) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
        return { migrated: false, reason: 'invalid_user_id' };
    }

    const user = await User.findById(userId);
    if (!user) return { migrated: false, reason: 'user_not_found' };
    if (user.deletedAt) return { migrated: false, reason: 'user_deleted' };
    if (user.isBanned) return { migrated: false, reason: 'user_banned' };

    if ((user.familyProfiles || []).length > 0) {
        return { migrated: false, reason: 'already_has_profiles' };
    }

    if (!isFamilyEligible(user)) {
        return { migrated: false, reason: 'not_family_eligible' };
    }

    const profileId = new mongoose.Types.ObjectId();
    const ownerName = (user.fullName || '').trim() || 'Me';
    const firstName = ownerName.split(/\s+/)[0] || 'Me';

    // 1. Create the owner "Me" profile and switch the account into it
    const meProfile = {
        _id: profileId,
        name: firstName.slice(0, 40),
        emoji: '🧑',
        color: '#2E8B57',
        language: user.language || 'yoruba',
        role: 'owner',
        createdAt: new Date()
    };

    user.familyProfiles = [meProfile];
    user.activeProfileId = profileId;
    user.accountType = 'family';
    await user.save();

    const nullScope = {
        $or: [
            { profileId: null },
            { profileId: { $exists: false } }
        ]
    };
    const nullScopeA = {
        $or: [
            { profileIdA: null },
            { profileIdA: { $exists: false } }
        ]
    };
    const nullScopeB = {
        $or: [
            { profileIdB: null },
            { profileIdB: { $exists: false } }
        ]
    };

    const [
        progressRes,
        lessonRes,
        freezeRes,
        timmyRes,
        cardRes,
        pairARes,
        pairBRes,
        pairMsgRes,
        podMsgRes,
        referralRes,
        notifRes,
        usageRes
    ] = await Promise.all([
        Progress.updateMany({ userId: user._id, ...nullScope }, { $set: { profileId } }),
        LessonCompletion.updateMany({ userId: user._id, ...nullScope }, { $set: { profileId } }),
        StreakFreeze.updateMany({ userId: user._id, ...nullScope }, { $set: { profileId } }),
        TimmyChat.updateMany({ userId: user._id, ...nullScope }, { $set: { profileId } }),
        ProgressCard.updateMany({ userId: user._id, ...nullScope }, { $set: { profileId } }),
        Pair.updateMany({ userA: user._id, ...nullScopeA }, { $set: { profileIdA: profileId } }),
        Pair.updateMany({ userB: user._id, ...nullScopeB }, { $set: { profileIdB: profileId } }),
        PairMessage.updateMany({ senderId: user._id, ...nullScope }, { $set: { profileId } }),
        PodMessage.updateMany({ authorId: user._id, ...nullScope }, { $set: { profileId } }),
        Referral.updateMany({ referrerId: user._id, ...nullScope }, { $set: { profileId } }),
        Notification.updateMany({ userId: user._id, ...nullScope }, { $set: { profileId } }),
        UsageCounter.updateMany({ userId: user._id, ...nullScope }, { $set: { profileId } })
    ]);

    let podsTouched = 0;
    const pods = await Pod.find({ 'members.userId': user._id });
    for (const pod of pods) {
        let changed = false;
        pod.members.forEach(m => {
            if (m.userId.toString() !== user._id.toString()) return;
            if (!m.familyId) { m.familyId = user._id; changed = true; }
            if (!m.profileId) { m.profileId = profileId; changed = true; }
        });
        if (changed) {
            podsTouched += 1;
            await pod.save();
        }
    }

    return {
        migrated: true,
        profileId,
        moved: {
            progress: progressRes.modifiedCount || 0,
            lessonCompletions: lessonRes.modifiedCount || 0,
            streakFreezes: freezeRes.modifiedCount || 0,
            timmyChats: timmyRes.modifiedCount || 0,
            progressCards: cardRes.modifiedCount || 0,
            pairsAsA: pairARes.modifiedCount || 0,
            pairsAsB: pairBRes.modifiedCount || 0,
            pairMessages: pairMsgRes.modifiedCount || 0,
            podMessages: podMsgRes.modifiedCount || 0,
            referrals: referralRes.modifiedCount || 0,
            notifications: notifRes.modifiedCount || 0,
            usageCounters: usageRes.modifiedCount || 0,
            pods: podsTouched
        }
    };
}

export default migratePersonalUserToFamily;