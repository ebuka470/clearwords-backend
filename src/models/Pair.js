import mongoose from 'mongoose';

const PairSchema = new mongoose.Schema({
    // User A is learning languageA, teaching languageB
    userA: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    languageA: { type: String, required: true },  // what userA is learning / userB teaches
    languageB: { type: String, required: true },  // what userB is learning / userA teaches

    status: {
        type: String,
        enum: ['pending', 'active', 'ended', 'dissolved'],
        default: 'pending'
    },

    matchedAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    endReason: { type: String, enum: ['manual', 'report', 'inactive', 'auto'], default: null },

    // Feature flags per tier
    voiceEnabled: { type: Boolean, default: false },
    videoEnabled: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

PairSchema.index({ userA: 1, status: 1 });
PairSchema.index({ userB: 1, status: 1 });
PairSchema.index({ lastActivityAt: 1, status: 1 });

const Pair = mongoose.model('Pair', PairSchema);

export default Pair;