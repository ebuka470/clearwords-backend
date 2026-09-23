import mongoose from 'mongoose';

const PodSchema = new mongoose.Schema({
    name: { type: String, required: true, maxlength: 60 },
    description: { type: String, maxlength: 300, default: '' },

    language: { type: String, required: true, index: true },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
    timezone: { type: String, default: 'Africa/Lagos' },

    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    isPrivate: { type: Boolean, default: true },
    isAutoMatched: { type: Boolean, default: false },

    members: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        joinedAt: { type: Date, default: Date.now },
        role: { type: String, enum: ['member', 'leader'], default: 'member' }
    }],

    maxMembers: { type: Number, default: 8, min: 5, max: 8 },

    // Weekly accountability
    weeklyGoal: { type: Number, default: 5 },
    sharedStreak: { type: Number, default: 0 },
    lastStreakCheck: { type: Date, default: null },

    // Pod leaderboard
    weeklyXP: { type: Number, default: 0 },
    totalXP: { type: Number, default: 0 },

    inviteCode: { type: String, unique: true, sparse: true },

    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

PodSchema.index({ language: 1, level: 1, isActive: 1 });
PodSchema.index({ 'members.userId': 1 });

PodSchema.pre('save', function(next) {
    if (!this.inviteCode) {
        this.inviteCode = 'POD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    this.updatedAt = new Date();
    next();
});

const Pod = mongoose.model('Pod', PodSchema);

export default Pod;