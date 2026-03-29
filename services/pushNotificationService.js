const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Configure VAPID details
webpush.setVapidDetails(
  `mailto:${process.env.NOTIFICATION_EMAIL || 'noreply@moradabadujala.in'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Send push notification to a specific subscription
 */
const sendPushToSubscription = async (subscription, payload) => {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { success: true };
  } catch (error) {
    console.error('Push error:', error.message);
    
    // If subscription has expired or invalid, mark it as inactive
    if (error.statusCode === 404 || error.statusCode === 410) {
      await PushSubscription.updateOne(
        { 'subscription.endpoint': subscription.endpoint },
        { isActive: false }
      );
    }
    
    return { success: false, error: error.message };
  }
};

/**
 * Send notification to all active subscribers
 */
const sendNotificationToAll = async (payload) => {
  try {
    const subscriptions = await PushSubscription.find({ isActive: true });
    
    let sent = 0;
    let failed = 0;
    
    for (const sub of subscriptions) {
      const result = await sendPushToSubscription(sub.subscription, payload);
      if (result.success) {
        sent++;
      } else {
        failed++;
      }
    }
    
    console.log(`Push notifications sent: ${sent}, failed: ${failed}`);
    return { sent, failed, total: subscriptions.length };
  } catch (error) {
    console.error('Notification broadcast error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Build notification payload
 */
const buildNotification = (newsTitle, newsBody, newsUrl, newsImage = null) => {
  return {
    title: '📰 ' + newsTitle,
    body: newsBody,
    icon: newsImage || '/images/ujala_logo_updated-removebg-preview.png',
    image: newsImage, // Large banner image (360x240 or larger)
    badge: '/images/ujala_logo_updated-removebg-preview.png',
    tag: 'news-notification',
    requireInteraction: false,
    data: {
      url: newsUrl,
      timestamp: new Date().toISOString(),
    },
    actions: [
      {
        action: 'open',
        title: 'खुलें',
        icon: '/images/ujala_logo_updated-removebg-preview.png',
      },
    ],
  };
};

module.exports = {
  sendPushToSubscription,
  sendNotificationToAll,
  buildNotification,
};
