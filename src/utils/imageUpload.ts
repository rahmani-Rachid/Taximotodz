import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';
import { Platform } from 'react-native';

/**
 * يرفع صورة من URI محلي (نتيجة ImagePicker) إلى Firebase Storage ويرجّع رابط التحميل.
 *
 * ⚠️ نستخدم XMLHttpRequest على الأجهزة الحقيقية (مو fetch().blob()) — هذا الحل الموصى به
 * رسمياً من Firebase لهذي الحالة بالذات. fetch().blob() غير موثوق مع روابط content://
 * أو file:// المحلية على Android/iOS، وأحياناً يرجّع blob فاضي أو تالف بصمت بدون خطأ واضح.
 */
export async function uploadImageAsync(uri: string, storagePath: string): Promise<string> {
  const storage  = getStorage();
  const fileRef  = storageRef(storage, storagePath);
  const contentType = 'image/jpeg';

  let blob: Blob;

  if (Platform.OS === 'web') {
    // على الويب: fetch().blob() يشتغل بشكل طبيعي وموثوق
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    blob = await response.blob();
  } else {
    // Native (Android/iOS): XMLHttpRequest هو الحل الموثوق للحصول على Blob من URI محلي
    blob = await new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onerror = () => reject(new TypeError('Network request failed'));
      xhr.onload = () => {
        // @ts-ignore — بـ React Native، xhr.response يكون Blob مباشرة
        resolve(xhr.response);
      };
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
  }

  await uploadBytes(fileRef, blob, { contentType });
  return getDownloadURL(fileRef);
}

