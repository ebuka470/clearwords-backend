import mongoose from 'mongoose';

const ProgressCardSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    username: { type: String, required: true },
    avatarUrl: { type: String, default: '' },

    language: { type: String, required: true },
    cardType: {
        type: String,
        enum: ['streak', 'lessons', 'vocab', 'pronunciation', 'milestone'],
        required: true
    },

    stats: {
        streak: Number,
        lessonsCompleted: Number,
        wordsMastered: Number,
        pronunciationScore: Number,
        xp: Number,
        level: Number
    },

    caption: { type: String, maxlength: 200, default: '' },

    // Rendered image
    imageUrl: { type: String, default: '' },
    imagePath: { type: String, default: '' },
    rendered: { type: Boolean, default: false },
    renderedAt: { type: Date, default: null },

    sharedInternally: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pod' }],
    sharedExternally: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now }
});

ProgressCardSchema.index({ userId: 1, createdAt: -1 });

const ProgressCard = mongoose.model('ProgressCard', ProgressCardSchema);

export default ProgressCard;