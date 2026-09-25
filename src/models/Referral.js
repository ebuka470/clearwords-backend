import mongoose from 'mongoose';

const ReferralSchema = new mongoose.Schema({
    // Who did the referring
    referrerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    referrerCode: { type: String, required: true, index: true },

    // Who was referred
    referredUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    referredEmail: { type: String, required: true },
    referredAuth0Id: { type: String, required: true },

    // Lifecycle
    signedUpAt: { type: Date, default: Date.now },
    completedFirstLessonAt: { type: Date, default: null },
    rewardedAt: { type: Date, default: null },

    // Status
    status: {
        type: String,
        enum: ['pending', 'qualified', 'rejected', 'rewarded'],
        default: 'pending'
    },
    rejectionReason: { type: String, default: null },

    // Reward details (per completed referral)
    rewardDays: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

ReferralSchema.index({ referrerId: 1, status: 1 });
ReferralSchema.index({ referrerId: 1, qualifiedAt: -1 });

ReferralSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const Referral = mongoose.model('Referral', ReferralSchema);

export default Referral;