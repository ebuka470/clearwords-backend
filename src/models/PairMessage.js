import mongoose from 'mongoose';

const PairMessageSchema = new mongoose.Schema({
    pairId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pair', required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 2000 },
    isDeleted: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    flaggedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now }
});

PairMessageSchema.index({ pairId: 1, createdAt: -1 });

const PairMessage = mongoose.model('PairMessage', PairMessageSchema);

export default PairMessage;