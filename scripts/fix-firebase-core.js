const fs = require('fs');

const p = 'node_modules/expo-firebase-core/android/build.gradle';

if (fs.existsSync(p)) {
  let c = fs.readFileSync(p, 'utf8');
  if (c.includes("classifier = 'sources'")) {
    c = c.replace("classifier = 'sources'", "archiveClassifier.set('sources')");
    fs.writeFileSync(p, c, 'utf8');
    console.log('تم إصلاح expo-firebase-core بنجاح');
  } else {
    console.log('مُصلَح مسبقاً، لا حاجة لأي تغيير');
  }
} else {
  console.log('expo-firebase-core غير موجود، لا حاجة للإصلاح');
}
