import mongoose from 'mongoose';

const PodMessageSchema = new mongoose.Schema({
    podId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pod', required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorUsername: { type: String, required: true },
    authorAvatar: { type: String, default: '' },
    text: { type: String, required: true, maxlength: 2000 },
    type: { type: String, enum: ['text', 'checkin', 'system'], default: 'text' },
    isDeleted: { type: Boolean, default: false },
    flaggedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now }
});

PodMessageSchema.index({ podId: 1, createdAt: -1 });

const PodMessage = mongoose.model('PodMessage', PodMessageSchema);

export default PodMessage;