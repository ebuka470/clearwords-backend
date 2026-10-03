import mongoose from 'mongoose';

const ReadReceiptSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    contextType: {
        type: String,
        enum: ['pod', 'pair'],
        required: true
    },
    contextId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    lastReadAt: {
        type: Date,
        default: new Date(0),
        required: true
    }
}, { timestamps: true });

ReadReceiptSchema.index(
    { userId: 1, contextType: 1, contextId: 1 },
    { unique: true }
);

const ReadReceipt = mongoose.model('ReadReceipt', ReadReceiptSchema);
export default ReadReceipt;