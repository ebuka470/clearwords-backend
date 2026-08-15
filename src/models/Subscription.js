const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tier: { type: String, enum: ['premium', 'immersive'], required: true },
    provider: { type: String, default: 'paystack' },
    providerSubscriptionId: { type: String, default: null },
    providerCustomerId: { type: String, default: null },
    status: {
        type: String,
        enum: ['pending', 'active', 'canceled', 'expired', 'failed'],
        default: 'pending'
    },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    amountPaid: { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },
    paymentMethod: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);