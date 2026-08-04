/* index.js — Cloud Functions (modular admin + v2 functions) */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError }                   = require('firebase-functions/v2/https');
const { initializeApp }                        = require('firebase-admin/app');
const { getFirestore, FieldValue }             = require('firebase-admin/firestore');
const { default: fetch }                       = require('node-fetch');

initializeApp();
const db = getFirestore();

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;

// Utility: split array into chunks
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * sendPush
 * - tokenEntries: array of either string tokens OR objects { token, path } where path is the doc path to clean if token invalid
 * - returns summary { success: true, sent: n, errors: [...] }
 */
async function sendPush(tokenEntries = [], title = '', body = '', data = {}) {
  const entries = tokenEntries.map(e => {
    if (!e) return null;
    if (typeof e === 'string') return { token: e, path: null };
    return { token: e.token || e.expoPushToken, path: e.path || null };
  }).filter(Boolean);

  const valid = entries.filter(e => typeof e.token === 'string' && e.token.startsWith('ExponentPushToken'));
  if (!valid.length) return { success: true, sent: 0, cleaned: 0 };

  const messages = valid.map((e) => ({
    to: e.token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high'
  }));

  const ownerMap = valid.map(e => e.path || null);

  const chunks = chunkArray(messages, EXPO_CHUNK_SIZE);
  let totalSent = 0;
  let totalCleaned = 0;
  const errors = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const startIndex = i * EXPO_CHUNK_SIZE;

    const res = await fetch(EXPO_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      errors.push({ status: res.status, text });
      console.error('Expo send error', res.status, text);
      continue;
    }

    const json = await res.json().catch(() => null);
    const resultsArray = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : null);

    if (!resultsArray) {
      totalSent += chunk.length;
      continue;
    }

    const cleanupPromises = [];
    for (let j = 0; j < resultsArray.length; j++) {
      const r = resultsArray[j];
      const globalIndex = startIndex + j;
      const ownerPath = ownerMap[globalIndex] || null;

      if (r.status === 'ok' || r.status === 'success' || r.id) {
        totalSent += 1;
        continue;
      }

      const errDetail = (r.details && r.details.error) || r.message || r.error;
      if (errDetail && typeof errDetail === 'string' && (errDetail.toLowerCase().includes('notregistered') || errDetail.toLowerCase().includes('devicenotregistered'))) {
        if (ownerPath) {
          cleanupPromises.push(
            db.doc(ownerPath).update({ expoPushToken: null }).then(() => { totalCleaned += 1; }).catch(err => {
              console.warn('Failed to clean token at', ownerPath, err.message || err);
            })
          );
        }
        continue;
      }

      errors.push({ index: globalIndex, error: errDetail || r });
    }

    if (cleanupPromises.length) {
      await Promise.all(cleanupPromises);
    }
  }

  return { success: errors.length === 0, sent: totalSent, cleaned: totalCleaned, errors };
}

// ---------------------------- Functions ----------------------------

// 1) New ride -> broadcast to available drivers
exports.onNewRide = onDocumentCreated('rides/{rideId}', async (event) => {
  const ride = event.data.data();
  const rideId = event.params.rideId;
  if (!ride || ride.status !== 'pending') return null;

  const driversSnap = await db.collection('drivers')
    .where('kyc_status', '==', 'approved')
    .where('isOnline', '==', true)
    .get();

  const tokenEntries = driversSnap.docs
    .map(d => ({ token: d.data().expoPushToken, path: `drivers/${d.id}` }))
    .filter(e => e.token);

  if (!tokenEntries.length) {
    console.log('onNewRide: no driver tokens found for ride', rideId);
    return null;
  }

  return await sendPush(
    tokenEntries,
    '🏍️ طلب رحلة جديد!',
    `من: ${ride.fromLabel || 'موقع الزبون'} → إلى: ${ride.toLabel || 'الوجهة'}`,
    { rideId, type: 'new_ride' }
  );
});

// 2) Ride updated -> various notifications
exports.onRideAccepted = onDocumentUpdated('rides/{rideId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const rideId = event.params.rideId;
  if (!before || !after) return null;
  if (before.status === after.status) return null;

  if (after.status === 'accepted' && before.status === 'pending') {
    const customerDocPath = `users/${after.customerId}`;
    const customerSnap = await db.doc(customerDocPath).get();
    const token = customerSnap.data()?.expoPushToken;
    const driverSnap = await db.collection('drivers').doc(after.driverId).get();
    const driverName = driverSnap.data()?.name || 'السائق';
    if (token) {
      return await sendPush([{ token, path: customerDocPath }], '✅ تم قبول طلبك!', `${driverName} في طريقه إليك`, { rideId, type: 'ride_accepted' });
    }
    return null;
  }

  if (after.status === 'arrived' && before.status === 'accepted') {
    const customerDocPath = `users/${after.customerId}`;
    const customerSnap = await db.doc(customerDocPath).get();
    const token = customerSnap.data()?.expoPushToken;
    if (token) {
      return await sendPush([{ token, path: customerDocPath }], '🏍️ السائق وصل!', 'السائق ينتظرك الآن', { rideId, type: 'driver_arrived' });
    }
    return null;
  }

  if (after.status === 'completed') {
    const customerDocPath = `users/${after.customerId}`;
    const customerSnap = await db.doc(customerDocPath).get();
    const token = customerSnap.data()?.expoPushToken;
    if (token) {
      return await sendPush([{ token, path: customerDocPath }], '⭐ كيف كانت رحلتك؟', 'قيّم سائقك الآن', { rideId, type: 'ride_completed' });
    }
    return null;
  }

  if (after.status === 'cancelled') {
    if (after.driverId) {
      const driverDocPath = `drivers/${after.driverId}`;
      const driverSnap = await db.doc(driverDocPath).get();
      const token = driverSnap.data()?.expoPushToken;
      if (token) {
        return await sendPush(
          [{ token, path: driverDocPath }],
          '❌ الرحلة ملغاة',
          'قام الزبون بإلغاء الطلب',
          { rideId, type: 'ride_cancelled' }
        );
      } else {
        console.log('onRideAccepted: no driver token for cancelled ride', rideId, after.driverId);
      }
    }
    return null;
  }

  return null;
});

// 3) Broadcast (callable) — only admins (checked via admins collection)
exports.broadcastNotification = onCall(async (request) => {
  const auth = request.auth;
  if (!auth || !auth.uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول.');

  const adminDoc = await db.collection('admins').doc(auth.uid).get();
  if (!adminDoc.exists) throw new HttpsError('permission-denied', 'غير مصرح لك بهذه العملية');

  const { title, body, target } = request.data || {};
  if (!title || !body) throw new HttpsError('invalid-argument', 'العنوان والنص مطلوبان');

  const tokenEntries = [];

  if (!target || target === 'all' || target === 'customers') {
    const snap = await db.collection('users').get();
    snap.docs.forEach(d => {
      const t = d.data().expoPushToken;
      if (t) tokenEntries.push({ token: t, path: `users/${d.id}` });
    });
  }

  if (!target || target === 'all' || target === 'drivers') {
    const snap = await db.collection('drivers').where('kyc_status', '==', 'approved').get();
    snap.docs.forEach(d => {
      const t = d.data().expoPushToken;
      if (t) tokenEntries.push({ token: t, path: `drivers/${d.id}` });
    });
  }

  if (!tokenEntries.length) {
    return { success: false, sent: 0, message: 'No tokens found for the selected target' };
  }

  const res = await sendPush(tokenEntries, title, body, { type: 'broadcast', target });
  return { success: res.success, sent: res.sent || 0, cleaned: res.cleaned || 0, errors: res.errors || [] };
});

// 4) Support message -> notify all admins that have expoPushToken
exports.onSupportMessage = onDocumentCreated('support/{msgId}', async (event) => {
  const msg = event.data.data() || {};
  const msgId = event.params.msgId;

  const adminsSnap = await db.collection('admins').where('expoPushToken', '!=', null).get();
  const tokenEntries = adminsSnap.docs
    .map(d => ({ token: d.data().expoPushToken, path: `admins/${d.id}` }))
    .filter(e => e.token);

  if (!tokenEntries.length) {
    console.log('onSupportMessage: no admin tokens found for support message', msgId);
    return null;
  }

  const preview = (msg.message || '').slice(0, 60);
  return await sendPush(
    tokenEntries,
    '📩 رسالة دعم جديدة',
    `من: ${msg.userName || 'مستخدم'} — ${preview}`,
    { msgId, type: 'support_message' }
  );
});

// 5) Driver KYC status change (مُصحَّحة لاستخدام sendPush بدل notify غير الموجودة)
exports.onDriverKycStatusChange = onDocumentUpdated('drivers/{driverId}', async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  const driverId = event.params.driverId;

  if (before.kyc_status === after.kyc_status) return null;

  const driverDocPath = `drivers/${driverId}`;
  const token = after.expoPushToken;
  if (!token) return null;

  if (after.kyc_status === 'approved') {
    return await sendPush(
      [{ token, path: driverDocPath }],
      '🎉 تمت الموافقة على حسابك!', 'يمكنك الآن تسجيل الدخول والبدء باستقبال الرحلات',
      { driverId, type: 'kyc_approved' },
    );
  }

  if (after.kyc_status === 'rejected') {
    return await sendPush(
      [{ token, path: driverDocPath }],
      '❌ تعذّرت الموافقة على حسابك', 'بطاقة الدراجة أو بياناتك لم تُطابق الشروط. تواصل مع الدعم لمزيد من التفاصيل',
      { driverId, type: 'kyc_rejected' },
    );
  }

  return null;
});

// 6) New offer on a ride (مُصحَّحة لاستخدام sendPush بدل notify غير الموجودة)
exports.onNewOffer = onDocumentCreated('rides/{rideId}/offers/{driverId}', async (event) => {
  const offer  = event.data.data();
  const rideId = event.params.rideId;

  const rideSnap = await db.collection('rides').doc(rideId).get();
  const ride = rideSnap.data();
  if (!ride?.customerId) return null;

  const customerDocPath = `users/${ride.customerId}`;
  const customerSnap = await db.doc(customerDocPath).get();
  const token = customerSnap.data()?.expoPushToken;
  if (!token) return null;

  return await sendPush(
    [{ token, path: customerDocPath }],
    '🎁 عرض جديد وصلك',
    `${offer.driverName || 'سائق'} اقترح ${offer.price} DZD`,
    { rideId, type: 'new_offer' },
  );
});

// ---------------------------- WhatsApp OTP ----------------------------

const WHATSAPP_TEMPLATE_NAME = 'otp_verify';
const WHATSAPP_TEMPLATE_LANG = 'ar';

async function sendWhatsAppOtp(phoneE164, code) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error('إعدادات WhatsApp غير مكتملة على الخادم');

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneE164.replace('+', ''),
      type: 'template',
      template: {
        name: WHATSAPP_TEMPLATE_NAME,
        language: { code: WHATSAPP_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('فشل إرسال WhatsApp:', res.status, text);
    throw new Error('فشل إرسال رمز التحقق عبر WhatsApp');
  }
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

exports.requestOtp = onCall(async (request) => {
  const phone = request.data?.phone;
  if (!phone || !/^\+213[5-7][0-9]{8}$/.test(phone)) {
    throw new HttpsError('invalid-argument', 'رقم الهاتف غير صحيح');
  }

  const code = generateOtpCode();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  await db.collection('otpCodes').doc(phone).set({
    code, expiresAt, attempts: 0, createdAt: FieldValue.serverTimestamp(),
  });

  await sendWhatsAppOtp(phone, code);

  return { success: true };
});

exports.verifyOtp = onCall(async (request) => {
  const { phone, code } = request.data || {};
  if (!phone || !code) throw new HttpsError('invalid-argument', 'بيانات ناقصة');

  const ref = db.collection('otpCodes').doc(phone);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'لم يُرسَل رمز لهذا الرقم، اطلب رمزاً جديداً');

  const data = snap.data();

  if (Date.now() > data.expiresAt) {
    await ref.delete();
    throw new HttpsError('deadline-exceeded', 'انتهت صلاحية الرمز، اطلب رمزاً جديداً');
  }

  if ((data.attempts ?? 0) >= 5) {
    await ref.delete();
    throw new HttpsError('resource-exhausted', 'محاولات كثيرة جداً، اطلب رمزاً جديداً');
  }

  if (data.code !== code) {
    await ref.update({ attempts: FieldValue.increment(1) });
    throw new HttpsError('permission-denied', 'الرمز غير صحيح');
  }

  await ref.delete();
  return { success: true };
});

