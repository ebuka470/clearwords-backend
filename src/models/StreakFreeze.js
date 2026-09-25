import mongoose from 'mongoose';

const StreakFreezeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    language: { type: String, required: true },

    // Inventory: how many freezes the user currently holds
    available: { type: Number, default: 0, min: 0 },

    // History
    purchases: [{
        purchasedAt: { type: Date, default: Date.now },
        source: { type: String, enum: ['xp', 'referral', 'weekly_bonus', 'admin'], required: true },
        xpCost: { type: Number, default: 0 }
    }],

    // Usage log
    used: [{
        usedAt: { type: Date, default: Date.now },
        protectedDate: { type: String }, // YYYY-MM-DD that was protected
        previousStreak: { type: Number }
    }],

    // Auto-apply settings
    autoApply: { type: Boolean, default: true },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

StreakFreezeSchema.index({ userId: 1, language: 1 }, { unique: true });

StreakFreezeSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const StreakFreeze = mongoose.model('StreakFreeze', StreakFreezeSchema);

export default StreakFreeze;