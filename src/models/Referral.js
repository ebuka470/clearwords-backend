import mongoose from 'mongoose';

const ReferralSchema = new mongoose.Schema(
    {
        // ============================================
        // REFERRER
        // ============================================

        referrerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },

        referrerCode: {
            type: String,
            required: true,
            index: true
        },

        // ============================================
        // REFERRED USER
        // ============================================

        referredUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true
        },

        referredEmail: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },

        // ============================================
        // LIFECYCLE
        // ============================================

        signedUpAt: {
            type: Date,
            default: Date.now
        },

        completedFirstLessonAt: {
            type: Date,
            default: null
        },

        rewardedAt: {
            type: Date,
            default: null
        },

        // ============================================
        // STATUS
        // ============================================

        status: {
            type: String,
            enum: [
                'pending',
                'qualified',
                'rejected',
                'rewarded'
            ],
            default: 'pending'
        },

        rejectionReason: {
            type: String,
            default: null
        },

        // ============================================
        // REWARD
        // ============================================

        rewardDays: {
            type: Number,
            default: 0
        },

        // ============================================
        // DATES
        // ============================================

        createdAt: {
            type: Date,
            default: Date.now
        },

        updatedAt: {
            type: Date,
            default: Date.now
        }
    }
);

// ============================================
// INDEXES
// ============================================

ReferralSchema.index({
    referrerId: 1,
    status: 1
});

ReferralSchema.index({
    referrerId: 1,
    completedFirstLessonAt: -1
});

// ============================================
// PRE-SAVE
// ============================================

ReferralSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const Referral = mongoose.model(
    'Referral',
    ReferralSchema
);

export default Referral;