import mongoose from 'mongoose';

const PushSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  keys: {
    p256dh: { type: String, required: true },
    auth:   { type: String, required: true }
  },
  userAgent: {
    type: String,
    default: '',
    maxlength: 300
  },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now }
});

// Cleanup helper — called by the push service when the endpoint dies
PushSubscriptionSchema.statics.removeByEndpoint = function (endpoint) {
  return this.deleteOne({ endpoint });
};

const PushSubscription = mongoose.model('PushSubscription', PushSubscriptionSchema);
export default PushSubscription;