import express from 'express';
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
import Notification from '../models/Notification.js';
import UsageCounter from '../models/UsageCounter.js';
import { authenticateUser } from '../middleware/auth.js';
import {
    migratePersonalUserToFamily,
    isFamilyEligible
} from '../services/profileMigration.js';

const router = express.Router();

const MAX_PROFILES = 6;
const VALID_LANGUAGES = ['yoruba', 'igbo', 'hausa', 'pidgin', 'urhobo', 'itsekiri'];

/* ============================================================
   HELPERS
   ============================================================ */

function publicProfile(p, userContext = null) {
    // If this is the owner profile, we want to pull the actual name/bio/location 
    // from the main User document so it reflects the primary account details.
    const isOwner = p.role === 'owner';
    
    return {
        _id: p._id,
        name: isOwner && userContext ? userContext.fullName : p.name,
        emoji: p.emoji,
        color: p.color,
        language: p.language,
        role: p.role,
        createdAt: p.createdAt,
        bio: isOwner && userContext ? userContext.bio : '',
        location: isOwner && userContext ? userContext.location : ''
    };
}

function cleanStr(v, max) {
    return String(v == null ? '' : v).trim().slice(0, max);
}

/* ============================================================
   POST /api/profiles/enable-family
   ============================================================ */
router.post('/enable-family', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!isFamilyEligible(user)) {
            return res.status(403).json({
                error: 'Family accounts require Premium or Immersive',
                currentTier: user.subscriptionTier,
                feature: 'family'
            });
        }

        const result = await migratePersonalUserToFamily(req.userId);

        if (!result.migrated) {
            return res.status(200).json({
                success: true,
                migrated: false,
                reason: result.reason,
                activeProfileId: user.activeProfileId || null
            });
        }

        res.status(201).json({
            success: true,
            migrated: true,
            activeProfileId: result.profileId,
            moved: result.moved
        });
    } catch (err) {
        console.error('Enable family error:', err);
        res.status(400).json({ error: err.message });
    }
});

/* ============================================================
   GET /api/profiles
   ============================================================ */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let profiles = [...(user.familyProfiles || [])];
        const hasOwner = profiles.some(p => p.role === 'owner');
        
        // Dynamically inject the Owner profile if it doesn't exist
        // This allows a user to switch back to their main account.
        if (!hasOwner) {
            profiles.unshift({
                _id: user._id, 
                name: user.fullName ? user.fullName.split(' ')[0] : 'Me',
                emoji: '🧑',
                color: '#2E8B57',
                language: user.language || 'yoruba',
                role: 'owner',
                createdAt: user.createdAt
            });
        }

        res.json({
            profiles: profiles.map(p => publicProfile(p, user)),
            activeProfileId: user.activeProfileId || null,
            maxProfiles: MAX_PROFILES
        });
    } catch (err) {
        console.error('List profiles error:', err);
        res.status(400).json({ error: err.message });
    }
});

/* ============================================================
   POST /api/profiles
   ============================================================ */
router.post('/', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!isFamilyEligible(user)) {
            return res.status(403).json({
                error: 'Family accounts require Premium or Immersive',
                currentTier: user.subscriptionTier,
                feature: 'family'
            });
        }

        if ((user.familyProfiles || []).length >= MAX_PROFILES) {
            return res.status(400).json({
                error: `Maximum of ${MAX_PROFILES} profiles per family`,
                maxProfiles: MAX_PROFILES
            });
        }

        const { name, emoji, color, language, role } = req.body || {};
        const cleanName = cleanStr(name, 40);
        if (!cleanName) return res.status(400).json({ error: 'name is required' });

        const cleanLang = language && VALID_LANGUAGES.includes(language)
            ? language
            : (user.language || 'yoruba');

        const profileRole = role === 'owner' ? 'owner' : 'learner';

        if (profileRole === 'owner') {
            const existingOwner = (user.familyProfiles || []).some(p => p.role === 'owner');
            if (existingOwner) return res.status(400).json({ error: 'An owner profile already exists' });
        }

        const newProfile = {
            _id: new mongoose.Types.ObjectId(),
            name: cleanName,
            emoji: cleanStr(emoji, 8) || '🧑',
            color: cleanStr(color, 16) || '#2E8B57',
            language: cleanLang,
            role: profileRole,
            createdAt: new Date()
        };

        user.familyProfiles.push(newProfile);
        await user.save();

        res.status(201).json({ profile: publicProfile(newProfile) });
    } catch (err) {
        console.error('Create profile error:', err);
        res.status(400).json({ error: err.message });
    }
});

/* ============================================================
   PATCH /api/profiles/:id
   ============================================================ */
router.patch('/:id', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // --- UPDATE MAIN ACCOUNT ---
        if (req.params.id === 'main' || req.params.id === user._id.toString()) {
            const { name, bio, location } = req.body;
            if (name !== undefined) user.fullName = cleanStr(name, 60);
            if (bio !== undefined) user.bio = cleanStr(bio, 500);
            if (location !== undefined) user.location = cleanStr(location, 100);
            await user.save();

            return res.json({
                profile: {
                    _id: user._id,
                    name: user.fullName,
                    role: 'owner',
                    bio: user.bio,
                    location: user.location
                }
            });
        }

        // --- UPDATE CHILD PROFILE ---
        const profile = (user.familyProfiles || []).find(
            p => p._id.toString() === req.params.id
        );
        if (!profile) return res.status(404).json({ error: 'Profile not found' });

        const { name, emoji, color, language } = req.body || {};

        if (name !== undefined) {
            const cleanName = cleanStr(name, 40);
            if (!cleanName) return res.status(400).json({ error: 'name cannot be empty' });
            profile.name = cleanName;
        }
        if (emoji !== undefined) profile.emoji = cleanStr(emoji, 8) || profile.emoji;
        if (color !== undefined) profile.color = cleanStr(color, 16) || profile.color;
        if (language !== undefined && VALID_LANGUAGES.includes(language)) {
            profile.language = language;
        }

        await user.save();
        res.json({ profile: publicProfile(profile) });
    } catch (err) {
        console.error('Patch profile error:', err);
        res.status(400).json({ error: err.message });
    }
});

/* ============================================================
   DELETE /api/profiles/:id
   ============================================================ */
router.delete('/:id', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const profile = (user.familyProfiles || []).find(
            p => p._id.toString() === req.params.id
        );
        if (!profile) return res.status(404).json({ error: 'Profile not found' });

        if (profile.role === 'owner' || req.params.id === user._id.toString()) {
            return res.status(400).json({ error: 'Cannot delete the main account profile' });
        }

        const pid = profile._id;

        const pods = await Pod.find({ 'members.profileId': pid });
        for (const pod of pods) {
            pod.formerMembers = pod.formerMembers || [];
            pod.formerMembers.push({ userId: user._id, leftAt: new Date() });
            pod.members = pod.members.filter(
                m => !(m.profileId && m.profileId.toString() === pid.toString())
            );
            if (pod.members.length === 0) pod.isActive = false;
            await pod.save();
        }

        await Pair.updateMany(
            {
                $or: [
                    { userA: user._id, profileIdA: pid },
                    { userB: user._id, profileIdB: pid }
                ],
                status: { $in: ['pending', 'active'] }
            },
            {
                $set: {
                    status: 'ended',
                    endedAt: new Date(),
                    endedBy: user._id,
                    endReason: 'profile_removed'
                }
            }
        );

        await Promise.all([
            Progress.deleteMany({ userId: user._id, profileId: pid }),
            LessonCompletion.deleteMany({ userId: user._id, profileId: pid }),
            StreakFreeze.deleteMany({ userId: user._id, profileId: pid }),
            TimmyChat.deleteMany({ userId: user._id, profileId: pid }),
            ProgressCard.deleteMany({ userId: user._id, profileId: pid }),
            PairMessage.deleteMany({ userId: user._id, profileId: pid }),
            PodMessage.deleteMany({ authorId: user._id, profileId: pid }),
            Notification.deleteMany({ userId: user._id, profileId: pid }),
            UsageCounter.deleteMany({ userId: user._id, profileId: pid })
        ]);

        user.familyProfiles = user.familyProfiles.filter(
            p => p._id.toString() !== pid.toString()
        );
        
        if (user.activeProfileId && user.activeProfileId.toString() === pid.toString()) {
            // If activeProfileId is the deleted one, revert to Main Account (null)
            user.activeProfileId = null; 
        }
        await user.save();

        res.json({
            success: true,
            activeProfileId: user.activeProfileId || null
        });
    } catch (err) {
        console.error('Delete profile error:', err);
        res.status(400).json({ error: err.message });
    }
});

/* ============================================================
   POST /api/profiles/:id/switch
   ============================================================ */
router.post('/:id/switch', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // --- HANDLE MAIN ACCOUNT SWITCH ---
        // If the ID is 'main' or matches the User's root _id, we switch to the Main Account
        if (req.params.id === 'main' || req.params.id === user._id.toString()) {
            user.activeProfileId = null;
            await user.save();

            const progress = await Progress.findOne({
                userId: user._id,
                profileId: null
            }).lean();

            return res.json({
                activeProfileId: null,
                profile: {
                    _id: user._id,
                    name: user.fullName,
                    role: 'owner',
                    bio: user.bio,
                    location: user.location
                },
                progress: progress ? {
                    language: progress.language,
                    currentLevel: progress.currentLevel || 1,
                    totalXP: progress.totalXP || 0,
                    streak: progress.streak || 0
                } : null
            });
        }

        // --- HANDLE CHILD PROFILE SWITCH ---
        const profile = (user.familyProfiles || []).find(
            p => p._id.toString() === req.params.id
        );
        if (!profile) return res.status(404).json({ error: 'Profile not found' });

        user.activeProfileId = profile._id;
        await user.save();

        const progress = await Progress.findOne({
            userId: user._id,
            profileId: profile._id
        }).lean();

        res.json({
            activeProfileId: profile._id,
            profile: publicProfile(profile, user),
            progress: progress ? {
                language: progress.language,
                currentLevel: progress.currentLevel || 1,
                totalXP: progress.totalXP || 0,
                streak: progress.streak || 0
            } : null
        });
    } catch (err) {
        console.error('Switch profile error:', err);
        res.status(400).json({ error: err.message });
    }
});

/* ============================================================
   GET /api/profiles/:id/overview
   ============================================================ */
router.get('/:id/overview', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let pid = null;
        let profileData = null;

        if (req.params.id !== user._id.toString()) {
            const profile = (user.familyProfiles || []).find(
                p => p._id.toString() === req.params.id
            );
            if (!profile) return res.status(404).json({ error: 'Profile not found' });
            pid = profile._id;
            profileData = profile;
        } else {
            profileData = { name: user.fullName, role: 'owner' };
        }

        const language = req.query.language || profileData.language || user.language || 'yoruba';

        const progress = await Progress.findOne({
            userId: user._id,
            profileId: pid,
            language
        }).lean();

        const recentLessons = await LessonCompletion.find({
            userId: user._id,
            profileId: pid,
            language
        })
            .sort({ completedAt: -1 })
            .limit(5)
            .select('lessonId levelId xpEarned perfect completedAt')
            .lean();

        const savedWords = (user.savedWords || [])
            .filter(w => w.language === language)
            .slice(0, 20)
            .map(w => ({
                word: w.word,
                translation: w.translation,
                pronunciation: w.pronunciation,
                savedAt: w.savedAt
            }));

        res.json({
            profile: profileData ? publicProfile(profileData, user) : null,
            language,
            level: progress?.currentLevel || 1,
            xp: progress?.totalXP || 0,
            streak: progress?.streak || 0,
            longestStreak: progress?.longestStreak || 0,
            completedLessonsCount: (progress?.completedLessons || []).length,
            recentLessons,
            savedWords
        });
    } catch (err) {
        console.error('Profile overview error:', err);
        res.status(400).json({ error: err.message });
    }
});

export default router;