const express = require('express');
const router = express.Router();
const PushSubscription = require('../models/PushSubscription');
const auth = require('../middleware/auth');

/**
 * POST /api/notifications/subscribe
 * Subscribe to push notifications
 * Body: { subscription: {endpoint, keys} }
 */
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid subscription object' 
      });
    }

    const token = req.headers.authorization?.split(' ')[1];
    let userId = null;

    // Try to get user ID if authenticated
    if (token) {
      try {
        const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        // Only use userId if it's a valid ObjectId format (not role strings like "superadmin")
        if (decoded.id && decoded.id.match(/^[0-9a-fA-F]{24}$/)) {
          userId = decoded.id;
        } else {
          console.log('[Notification] Invalid userId format, using anonymous subscription:', decoded.id);
        }
      } catch (e) {
        // User not authenticated, continue with anonymous subscription
      }
    }

    // Check if subscription already exists
    let pushSub = await PushSubscription.findOne({ 
      'subscription.endpoint': subscription.endpoint 
    });

    if (pushSub) {
      // Update existing subscription - reactivate and update all fields
      pushSub.subscription = subscription;
      pushSub.isActive = true;
      pushSub.userId = userId;
      pushSub.userAgent = req.headers['user-agent'];
      pushSub.ipAddress = req.ip;
      pushSub.subscribedAt = new Date();
      await pushSub.save();
      console.log('[Notification] Updated existing subscription:', pushSub._id, 'isActive:', pushSub.isActive);
    } else {
      // Create new subscription
      pushSub = new PushSubscription({
        userId,
        subscription,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        isActive: true,
      });
      await pushSub.save();
      console.log('[Notification] Created new subscription:', pushSub._id);
    }

    res.json({ 
      success: true, 
      message: 'Subscribed to notifications',
      subscriptionId: pushSub._id 
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * POST /api/notifications/unsubscribe
 * Unsubscribe from push notifications
 * Body: { endpoint }
 */
router.post('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    
    if (!endpoint) {
      return res.status(400).json({ 
        success: false, 
        message: 'Endpoint required' 
      });
    }

    await PushSubscription.updateOne(
      { 'subscription.endpoint': endpoint },
      { isActive: false }
    );

    res.json({ 
      success: true, 
      message: 'Unsubscribed from notifications' 
    });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * GET /api/notifications/vapid-key
 * Get VAPID public key for frontend
 */
router.get('/vapid-key', (req, res) => {
  res.json({ 
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

/**
 * GET /api/notifications/status
 * Check subscription status (for authenticated users)
 */
router.get('/status', auth.verifyToken, async (req, res) => {
  try {
    const subscriptionCount = await PushSubscription.countDocuments({ 
      userId: req.user.id,
      isActive: true 
    });

    res.json({ 
      success: true,
      hasSubscription: subscriptionCount > 0,
      subscriptionCount 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;
