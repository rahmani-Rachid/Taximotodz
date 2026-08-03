const fs = require('fs');
const path = require('path');

const gradleFile = 'node_modules/expo-firebase-core/android/build.gradle';
if (fs.existsSync(gradleFile)) {
  let c = fs.readFileSync(gradleFile, 'utf8');
  if (c.includes("classifier = 'sources'")) {
    c = c.replace("classifier = 'sources'", "archiveClassifier.set('sources')");
    fs.writeFileSync(gradleFile, c, 'utf8');
    console.log('تم إصلاح build.gradle');
  }
}

const base = 'node_modules/expo-firebase-core/android/src/main/java/expo/modules/firebase/core';

if (fs.existsSync(base)) {
  const packageContent = `package expo.modules.firebase.core;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.List;

public class FirebaseCorePackage implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
`;

  const moduleContent = `package expo.modules.firebase.core;

public class FirebaseCoreModule {
}
`;

  fs.writeFileSync(path.join(base, 'FirebaseCorePackage.java'), packageContent, 'utf8');
  fs.writeFileSync(path.join(base, 'FirebaseCoreModule.java'), moduleContent, 'utf8');
  console.log('تم استبدال ملفات Java المعطوبة في expo-firebase-core');
} else {
  console.log('expo-firebase-core غير موجود، لا حاجة للإصلاح');
}
