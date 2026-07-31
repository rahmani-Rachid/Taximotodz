const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError }                   = require('firebase-functions/v2/https');
const { initializeApp }                        = require('firebase-admin/app');
const { getFirestore, FieldValue }             = require('firebase-admin/firestore');
const { default: fetch }                       = require('node-fetch');

initializeApp();
const db = getFirestore();

// UID الأدمن (أنت فقط) — محمي من الخادم
const ADMIN_UID = 'H615VQXRWoMzdSvXe3U03gJCbwh2';

// ── دالة مساعدة لإرسال push فقط (بدون تخزين) ──
async function sendPush(tokens, title, body, data = {}) {
  const messages = tokens
    .filter(t => t && t.startsWith('ExponentPushToken'))
    .map(to => ({ to, title, body, data, sound: 'default', priority: 'high' }));
  if (!messages.length) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(messages),
  });
}

// ── دالة مساعدة تحفظ نسخة من الإشعار بـ Firestore عشان يظهر بجرس الإشعارات بالتطبيق ──
// (تشتغل حتى لو الجهاز ما استقبل الـ push فعلياً — مطفي أو بدون نت وقتها)
async function saveNotification(userId, title, body, data = {}) {
  if (!userId) return;
  await db.collection('notifications').add({
    userId,
    title,
    body,
    data,
    read:      false,
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
}

// ── دالة موحّدة: ترسل push وتخزّن نسخة بالتطبيق بنفس الوقت ──
async function notify(userId, token, title, body, data = {}) {
  await Promise.all([
    token ? sendPush([token], title, body, data) : Promise.resolve(),
    saveNotification(userId, title, body, data),
  ]);
}

// ── دالة مساعدة لجلب توكن الأدمن — نبحث بـ users ثم drivers (مو collection "admins" منفصلة، لأنها ما تُعبّى أبداً) ──
async function getAdminPushToken() {
  const userDoc = await db.doc(`users/${ADMIN_UID}`).get();
  if (userDoc.exists && userDoc.data()?.expoPushToken) return userDoc.data().expoPushToken;

  const driverDoc = await db.doc(`drivers/${ADMIN_UID}`).get();
  if (driverDoc.exists && driverDoc.data()?.expoPushToken) return driverDoc.data().expoPushToken;

  return null;
}

// ── 1. رحلة جديدة → إشعار للسائقين المتاحين ──
exports.onNewRide = onDocumentCreated('rides/{rideId}', async (event) => {
  const ride    = event.data.data();
  const rideId  = event.params.rideId;
  if (ride.status !== 'pending') return;

  const driversSnap = await db.collection('drivers')
    .where('kyc_status', '==', 'approved')
    .where('isOnline',   '==', true)
    .get();

  const title = '🏍️ طلب رحلة جديد!';
  const body  = `من: ${ride.pickupAddress || 'موقع الزبون'} → إلى: ${ride.destination || 'الوجهة'}`;
  const data  = { rideId, type: 'new_ride' };

  // نرسل ونخزّن لكل سائق متاح على حدة (يحتاج userId مو بس التوكن، عشان يظهر بجرسه هو تحديداً)
  await Promise.all(
    driversSnap.docs.map(d => notify(d.id, d.data().expoPushToken, title, body, data))
  );
});

// ── 2. تحديثات حالة الرحلة → إشعارات للزبون والسائق ──
exports.onRideAccepted = onDocumentUpdated('rides/{rideId}', async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  const rideId = event.params.rideId;

  if (before.status === after.status) return;

  // الزبون اختار عرض سائق معيّن
  if (after.status === 'accepted' && before.status === 'pending') {
    const customerSnap = await db.collection('users').doc(after.customerId).get();
    const driverSnap   = await db.collection('drivers').doc(after.driverId).get();
    const driverName   = driverSnap.data()?.name || 'السائق';

    await notify(
      after.customerId, customerSnap.data()?.expoPushToken,
      '✅ تم قبول طلبك!', `${driverName} في طريقه إليك`,
      { rideId, type: 'ride_accepted' },
    );
    // ✅ إشعار السائق نفسه إن عرضه اتقبل (مهم لو التطبيق كان بالخلفية وقت الاختيار)
    await notify(
      after.driverId, driverSnap.data()?.expoPushToken,
      '🎉 تم قبول عرضك!', 'الزبون اختار عرضك — توجّه إليه الآن',
      { rideId, type: 'offer_accepted' },
    );
  }

  // سائق وصل
  if (after.status === 'arrived' && before.status === 'accepted') {
    const customerSnap = await db.collection('users').doc(after.customerId).get();
    await notify(
      after.customerId, customerSnap.data()?.expoPushToken,
      '🏍️ السائق وصل!', 'السائق ينتظرك الآن',
      { rideId, type: 'driver_arrived' },
    );
  }

  // رحلة اكتملت
  if (after.status === 'completed') {
    const customerSnap = await db.collection('users').doc(after.customerId).get();
    await notify(
      after.customerId, customerSnap.data()?.expoPushToken,
      '⭐ كيف كانت رحلتك؟', 'قيّم سائقك الآن',
      { rideId, type: 'ride_completed' },
    );
  }

  // رحلة ملغاة من طرف الزبون
  if (after.status === 'cancelled' && after.driverId) {
    const driverSnap = await db.collection('drivers').doc(after.driverId).get();
    await notify(
      after.driverId, driverSnap.data()?.expoPushToken,
      '❌ الرحلة ملغاة', 'قام الزبون بإلغاء الطلب',
      { rideId, type: 'ride_cancelled' },
    );
  }

  // رحلة ملغاة من طرف السائق → إشعار الزبون
  if (after.status === 'cancelled_by_driver') {
    const customerSnap = await db.collection('users').doc(after.customerId).get();
    await notify(
      after.customerId, customerSnap.data()?.expoPushToken,
      '⚠️ ألغى السائق الرحلة', 'جاري البحث عن سائق آخر تلقائياً',
      { rideId, type: 'ride_cancelled_by_driver' },
    );
  }
});

// ── 3. إشعار جماعي (أدمن فقط) — يُخزَّن لكل مستلم بجرسه الخاص ──
exports.broadcastNotification = onCall(async (request) => {
  if (!request.auth || request.auth.uid !== ADMIN_UID) {
    throw new HttpsError('permission-denied', 'غير مصرح لك بهذه العملية');
  }

  const { title, body, target } = request.data;
  if (!title || !body) throw new HttpsError('invalid-argument', 'العنوان والنص مطلوبان');

  const recipients = []; // { userId, token }

  if (target === 'all' || target === 'customers') {
    const snap = await db.collection('users').get();
    snap.docs.forEach(d => recipients.push({ userId: d.id, token: d.data().expoPushToken }));
  }
  if (target === 'all' || target === 'drivers') {
    const snap = await db.collection('drivers').where('kyc_status', '==', 'approved').get();
    snap.docs.forEach(d => recipients.push({ userId: d.id, token: d.data().expoPushToken }));
  }

  const data = { type: 'broadcast' };

  // إرسال الـ push دفعة وحدة (أسرع وأوفر) — والتخزين بـ Firestore لكل مستخدم على حدة بالتوازي
  await sendPush(recipients.map(r => r.token), title, body, data);
  await Promise.all(recipients.map(r => saveNotification(r.userId, title, body, data)));

  return { success: true, sent: recipients.length };
});

// ── 4. رسالة دعم من المستخدم → إشعار للأدمن ──
exports.onSupportMessage = onDocumentCreated('support/{msgId}', async (event) => {
  const msg = event.data.data();
  const adminToken = await getAdminPushToken();

  await notify(
    ADMIN_UID, adminToken,
    '📩 رسالة دعم جديدة',
    `من: ${msg.userName || 'مستخدم'} — ${msg.message?.slice(0, 60) || ''}`,
    { msgId: event.params.msgId, type: 'support_message' },
  );
});

// ── 5. تغيّر حالة مراجعة السائق (kyc_status) → إشعار السائق بالموافقة أو الرفض ──
exports.onDriverKycStatusChange = onDocumentUpdated('drivers/{driverId}', async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  const driverId = event.params.driverId;

  if (before.kyc_status === after.kyc_status) return;

  if (after.kyc_status === 'approved') {
    await notify(
      driverId, after.expoPushToken,
      '🎉 تمت الموافقة على حسابك!', 'يمكنك الآن تسجيل الدخول والبدء باستقبال الرحلات',
      { driverId, type: 'kyc_approved' },
    );
  }

  if (after.kyc_status === 'rejected') {
    await notify(
      driverId, after.expoPushToken,
      '❌ تعذّرت الموافقة على حسابك', 'بطاقة الدراجة أو بياناتك لم تُطابق الشروط. تواصل مع الدعم لمزيد من التفاصيل',
      { driverId, type: 'kyc_rejected' },
    );
  }
});// ⬇️ أضف هذا المقطع فقط داخل functions/index.js الموجود عندك (بنفس أسلوبك ونفس دالة notify() الموجودة أصلاً)
// هذا يغطي الحلقة الوحيدة الناقصة: إشعار الزبون فور وصول عرض سعر جديد من سائق،
// بدل انتظار قبول العرض فقط (الذي عندك إشعار له أصلاً في onRideAccepted)

// ── 6. عرض سعر جديد من سائق (rides/{rideId}/offers/{driverId}) → إشعار فوري للزبون صاحب الطلب ──
exports.onNewOffer = onDocumentCreated('rides/{rideId}/offers/{driverId}', async (event) => {
  const offer  = event.data.data();
  const rideId = event.params.rideId;

  const rideSnap = await db.collection('rides').doc(rideId).get();
  const ride = rideSnap.data();
  if (!ride?.customerId) return;

  const customerSnap = await db.collection('users').doc(ride.customerId).get();

  await notify(
    ride.customerId, customerSnap.data()?.expoPushToken,
    '🎁 عرض جديد وصلك',
    `${offer.driverName || 'سائق'} اقترح ${offer.price} DZD`,
    { rideId, type: 'new_offer' },
  );
});



