const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  // User ID (null if anonymous/not logged in)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Browser subscription object (contains endpoint, keys, etc.)
  subscription: {
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  // User agent to identify device/browser
  userAgent: { type: String },
  // IP address for tracking
  ipAddress: { type: String },
  // When subscription expires or becomes invalid
  expirationTime: { type: Date },
  // Is this subscription still active
  isActive: { type: Boolean, default: true },
  // Timestamp
  subscribedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
