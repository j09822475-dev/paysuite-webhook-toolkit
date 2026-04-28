/**
 * Sample payloads for use in snapshot / integration tests. Bodies are
 * provided as JSON strings so tests sign exact bytes.
 */

export const stripePaymentIntentSucceeded = JSON.stringify({
  id: 'evt_test_1',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_test_1',
      amount: 2000,
      currency: 'usd',
      status: 'succeeded',
    },
  },
});

export const githubPushEvent = JSON.stringify({
  ref: 'refs/heads/main',
  before: '0'.repeat(40),
  after: '1'.repeat(40),
  pusher: { name: 'test-user', email: 'test@example.com' },
});

export const shopifyOrderCreated = JSON.stringify({
  id: 1234567890,
  email: 'buyer@example.com',
  total_price: '42.00',
  currency: 'USD',
});

export const slackUrlVerification = JSON.stringify({
  type: 'url_verification',
  challenge: 'test-challenge-string',
});

export const svixUserCreated = JSON.stringify({
  type: 'user.created',
  data: { id: 'user_test_1' },
});

export const paddleSubscriptionUpdated = JSON.stringify({
  notification_id: 'ntf_test_1',
  event_type: 'subscription.updated',
  data: { id: 'sub_test_1' },
});

export const lemonSqueezyOrderCreated = JSON.stringify({
  meta: { event_name: 'order_created' },
  data: { id: 'ord_test_1', type: 'orders' },
});
