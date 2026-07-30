
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, fetchSignInMethodsForEmail, PhoneAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView,
  Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { registerForPushNotificationsAsync } from '../constants/pushNotifications';
import { useLanguage } from '../contexts/LanguageContext'; // ← اللغة الآن مشتركة عبر التطبيق
import { auth, db, storage } from '../utils/firebase';

type Lang  = 'ar' | 'fr' | 'en';
type Stage = 'form' | 'verify_phone' | 'password' | 'docs' | 'pending';

const T: Record<Lang, Record<string, string>> = {
  ar: {
    title:          'تسجيل سائق 🏍️',
    nameHint:       'يجب أن يتطابق الاسم واللقب مع رخصة السياقة',
    firstName:      'الاسم',
    lastName:       'اللقب',
    email:          'البريد الإلكتروني',
    phone:          'رقم الهاتف',
    phoneHint:      'أدخل الرقم مع رمز الدولة مثال: +213555123456',
    sendCode:       'إرسال كود التحقق 📱',
    haveAccount:    'لديك حساب؟ سجل الدخول',
    verifyTitle:    'تحقق من هاتفك',
    verifySub:      'أدخل الكود المُرسل إلى\n',
    resend:         'إعادة إرسال الكود',
    confirmCode:    'تأكيد الكود ✓',
    password:       'كلمة المرور',
    password2:      'تأكيد كلمة المرور',
    passHint:       '⚠️ احتفظ بكلمة المرور في مكان آمن',
    nextDocs:       'التالي — رفع الصور ←',
    selfieLabel:    '🤳 صورة شخصية (سيلفي)',
    selfieHint:     '⚠️ تأكد أن الصورة واضحة وغير مضببة، ووجهك ظاهر بالكامل في الإضاءة الجيدة',
    selfieBtn:      'اضغط لالتقاط سيلفي 📷',
    licenseLabel:   '📄 رخصة السياقة للدراجة',
    licenseBtn:     'اضغط لتصوير رخصة السياقة 📷',
    carteLabel:     '🏍️ البطاقة الرمادية (Carte Grise)',
    carteBtn:       'اضغط لتصوير البطاقة الرمادية 📷',
    send:           'إرسال الطلب ✓',
    pendingTitle:   'طلبك قيد المراجعة',
    pendingSub:     'تم استلام وثائقك بنجاح.\nسنراجعها خلال 24 ساعة\nوسيصلك إشعار عند القبول.',
    home:           'العودة للرئيسية 🏠',
    errFirst:       'أدخل الاسم',
    errLast:        'أدخل اللقب',
    errEmail:       'البريد الإلكتروني غير صحيح',
    errEmailUsed:   'هذا البريد الإلكتروني مستخدم بالفعل',
    errPhone:       'أدخل رقم الهاتف مع رمز الدولة (+213...)',
    errCode:        'الكود غير صحيح، حاول مجدداً',
    errPass:        'كلمة المرور 6 أحرف على الأقل',
    errPass2:       'كلمتا المرور غير متطابقتان',
    errSelfie:      'يجب التقاط السيلفي',
    errLicense:     'يجب تصوير رخصة السياقة',
    errCarte:       'يجب تصوير البطاقة الرمادية',
    steps:          ['المعلومات', 'الهاتف', 'كلمة المرور', 'الوثائق'],
  },
  fr: {
    title:          'Inscription chauffeur 🏍️',
    nameHint:       'Le prénom et le nom doivent correspondre au permis de conduire',
    firstName:      'Prénom',
    lastName:       'Nom',
    email:          'Email',
    phone:          'Numéro de téléphone',
    phoneHint:      'Avec indicatif pays ex: +213555123456',
    sendCode:       'Envoyer le code de vérification 📱',
    haveAccount:    'Vous avez un compte ? Connectez-vous',
    verifyTitle:    'Vérifiez votre téléphone',
    verifySub:      'Entrez le code envoyé au\n',
    resend:         'Renvoyer le code',
    confirmCode:    'Confirmer le code ✓',
    password:       'Mot de passe',
    password2:      'Confirmer le mot de passe',
    passHint:       '⚠️ Conservez votre mot de passe en lieu sûr',
    nextDocs:       'Suivant — Télécharger les photos →',
    selfieLabel:    '🤳 Photo personnelle (selfie)',
    selfieHint:     '⚠️ Assurez-vous que la photo est claire, non floue, et que votre visage est bien visible',
    selfieBtn:      'Appuyez pour prendre un selfie 📷',
    licenseLabel:   '📄 Permis de conduire moto',
    licenseBtn:     'Appuyez pour photographier le permis 📷',
    carteLabel:     '🏍️ Carte grise de la moto',
    carteBtn:       'Appuyez pour photographier la carte grise 📷',
    send:           'Envoyer la demande ✓',
    pendingTitle:   'Votre demande est en cours',
    pendingSub:     'Vos documents ont été reçus.\nNous les examinerons dans 24h\nVous recevrez une notification.',
    home:           "Retour à l'accueil 🏠",
    errFirst:       'Entrez le prénom',
    errLast:        'Entrez le nom',
    errEmail:       'Email invalide',
    errEmailUsed:   'Cet email est déjà utilisé',
    errPhone:       'Entrez le numéro avec indicatif (+213...)',
    errCode:        'Code incorrect, réessayez',
    errPass:        'Le mot de passe doit avoir 6 caractères minimum',
    errPass2:       'Les mots de passe ne correspondent pas',
    errSelfie:      'Veuillez prendre un selfie',
    errLicense:     'Veuillez photographier le permis',
    errCarte:       'Veuillez photographier la carte grise',
    steps:          ['Infos', 'Téléphone', 'Mot de passe', 'Documents'],
  },
  en: {
    title:          'Driver Registration 🏍️',
    nameHint:       'First and last name must match your driving license',
    firstName:      'First Name',
    lastName:       'Last Name',
    email:          'Email',
    phone:          'Phone Number',
    phoneHint:      'Include country code e.g: +213555123456',
    sendCode:       'Send Verification Code 📱',
    haveAccount:    'Have an account? Sign in',
    verifyTitle:    'Verify your phone',
    verifySub:      'Enter the code sent to\n',
    resend:         'Resend code',
    confirmCode:    'Confirm Code ✓',
    password:       'Password',
    password2:      'Confirm Password',
    passHint:       '⚠️ Keep your password in a safe place',
    nextDocs:       'Next — Upload Photos →',
    selfieLabel:    '🤳 Personal Photo (Selfie)',
    selfieHint:     '⚠️ Make sure the photo is clear, not blurry, and your face is fully visible',
    selfieBtn:      'Tap to take a selfie 📷',
    licenseLabel:   '📄 Motorcycle Driving License',
    licenseBtn:     'Tap to photograph the license 📷',
    carteLabel:     '🏍️ Vehicle Registration Card',
    carteBtn:       'Tap to photograph the registration card 📷',
    send:           'Submit Application ✓',
    pendingTitle:   'Your request is under review',
    pendingSub:     'Your documents have been received.\nWe will review them within 24 hours.\nYou will be notified upon approval.',
    home:           'Back to Home 🏠',
    errFirst:       'Enter first name',
    errLast:        'Enter last name',
    errEmail:       'Invalid email address',
    errEmailUsed:   'This email is already in use',
    errPhone:       'Enter phone with country code (+213...)',
    errCode:        'Incorrect code, please try again',
    errPass:        'Password must be at least 6 characters',
    errPass2:       'Passwords do not match',
    errSelfie:      'Please take a selfie',
    errLicense:     'Please photograph the license',
    errCarte:       'Please photograph the registration card',
    steps:          ['Info', 'Phone', 'Password', 'Documents'],
  },
};

export default function RegisterDriver() {
  const router       = useRouter();
  const scrollRef    = useRef<ScrollView>(null);
  const recaptchaRef = useRef<any>(null);

  const { lang } = useLanguage(); // ← القراءة فقط، الاختيار صار من القائمة الجانبية فقط
  const [stage,   setStage]   = useState<Stage>('form');
  const [loading, setLoading] = useState(false);

  const [firstName,     setFirstName]     = useState('');
  const [lastName,      setLastName]      = useState('');
  const [email,         setEmail]         = useState('');
  const [phone,         setPhone]         = useState('');
  const [enteredCode,   setEnteredCode]   = useState('');
  const [verificationId,setVerificationId]= useState('');
  const [password,      setPassword]      = useState('');
  const [password2,     setPassword2]     = useState('');
  const [selfieUri,     setSelfieUri]     = useState<string | null>(null);
  const [licenseUri,    setLicenseUri]    = useState<string | null>(null);
  const [carteGriseUri, setCarteGriseUri] = useState<string | null>(null);

  const t = T[lang];
  const isRTL = lang === 'ar';

  // ── تمرير صحيح ──
  const fieldOffsets = useRef<Record<string, number>>({});
  const scrollToField = (key: string) => {
    const y = fieldOffsets.current[key];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
  };

  // ── رفع صورة ──
  const uploadImage = async (uri: string, uid: string, fileName: string): Promise<string> => {
    const r = ref(storage, `drivers/${uid}/${fileName}`);
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = async () => {
        try {
          await uploadBytes(r, xhr.response);
          resolve(await getDownloadURL(r));
        } catch (e) { reject(e); }
      };
      xhr.onerror = reject;
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
  };

  // ── التحقق من الفورم + الإيميل أولاً ──
  const validateForm = async (): Promise<boolean> => {
    if (!firstName.trim())    { Alert.alert('خطأ', t.errFirst);   return false; }
    if (!lastName.trim())     { Alert.alert('خطأ', t.errLast);    return false; }
    if (!email.includes('@')) { Alert.alert('خطأ', t.errEmail);   return false; }
    if (!phone.startsWith('+') || phone.length < 10) {
      Alert.alert('خطأ', t.errPhone); return false;
    }
    setLoading(true);
    try {
      const methods = await fetchSignInMethodsForEmail(auth, email);
      if (methods.length > 0) {
        Alert.alert('❌', t.errEmailUsed);
        setLoading(false);
        return false;
      }
    } catch (_) {}
    setLoading(false);
    return true;
  };

  // ── إرسال SMS حقيقي ──
  const handleSendCode = async () => {
    const valid = await validateForm();
    if (!valid) return;
    setLoading(true);
    try {
      const formattedPhone = '+213' + phone;
      const provider = new PhoneAuthProvider(auth);
      const vId = await provider.verifyPhoneNumber(formattedPhone, recaptchaRef.current);
      setVerificationId(vId);
      setStage('verify_phone');
    } catch (e: any) {
      Alert.alert('خطأ', e.message);
    }
    setLoading(false);
  };

  // ── تأكيد الكود ──
  const verifyPhone = async () => {
    if (!enteredCode || enteredCode.length < 6) {
      Alert.alert('❌', t.errCode); return;
    }
    setLoading(true);
    try {
      const credential = PhoneAuthProvider.credential(verificationId, enteredCode);
      await signInWithCredential(auth, credential);
      setStage('password');
    } catch (e: any) {
      Alert.alert('❌', t.errCode);
    }
    setLoading(false);
  };

  // ── التقاط الصور ──
  const pickSelfie = async () => {
    const res = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: 0.85 });
    if (!res.canceled) setSelfieUri(res.assets[0].uri);
  };
  const pickLicense = async () => {
    const res = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.back, quality: 0.85 });
    if (!res.canceled) setLicenseUri(res.assets[0].uri);
  };
  const pickCarteGrise = async () => {
    const res = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.back, quality: 0.85 });
    if (!res.canceled) setCarteGriseUri(res.assets[0].uri);
  };

  // ── التسجيل النهائي ──
  const registerFinal = async () => {
    if (!selfieUri)     { Alert.alert('خطأ', t.errSelfie);  return; }
    if (!licenseUri)    { Alert.alert('خطأ', t.errLicense); return; }
    if (!carteGriseUri) { Alert.alert('خطأ', t.errCarte);   return; }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid  = cred.user.uid;
      const [selfieUrl, licenseUrl, carteGriseUrl] = await Promise.all([
        uploadImage(selfieUri!,     uid, 'selfie.jpg'),
        uploadImage(licenseUri!,    uid, 'license.jpg'),
        uploadImage(carteGriseUri!, uid, 'carte_grise.jpg'),
      ]);
      await setDoc(doc(db, 'drivers', uid), {
        name:         `${firstName.trim()} ${lastName.trim()}`,
        firstName:    firstName.trim(),
        lastName:     lastName.trim(),
        email, phone,
        selfieUrl, licenseUrl, carteGriseUrl,
        role:         'driver',
        kyc_status:   'pending',
        isOnline:     false,
        rating:       0,
        totalTrips:   0,
        createdAt:    serverTimestamp(),
      });
      await registerForPushNotificationsAsync('drivers');
      setStage('pending');
    } catch (e: any) {
      Alert.alert('خطأ', e.message);
    }
    setLoading(false);
  };

  const stageIndex: Record<Stage, number> = { form: 0, verify_phone: 1, password: 2, docs: 3, pending: 3 };
  const currentStep = stageIndex[stage];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={20}>

     

      <ScrollView ref={scrollRef} style={s.container}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={[s.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>{isRTL ? '→' : '←'}</Text>
          </TouchableOpacity>
          <Text style={s.title}>{t.title}</Text>
        </View>

        {/* مؤشر الخطوات */}
        {stage !== 'pending' && (
          <View style={s.stepsRow}>
            {t.steps.map((label, i) => (
              <View key={i} style={s.stepItem}>
                <View style={[s.stepCircle, i <= currentStep && s.stepCircleActive]}>
                  <Text style={[s.stepNum, i <= currentStep && s.stepNumActive]}>{i + 1}</Text>
                </View>
                <Text style={[s.stepLabel, i <= currentStep && s.stepLabelActive]} numberOfLines={1}>{label}</Text>
                {i < t.steps.length - 1 && (
                  <View style={[s.stepLine, i < currentStep && s.stepLineActive]} />
                )}
              </View>
            ))}
          </View>
        )}

        {/* ══ خطوة 1: المعلومات ══ */}
        {stage === 'form' && (
          <>
            <View style={[s.sectionHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Text style={s.sectionIcon}>👤</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.sectionHint, { textAlign: isRTL ? 'right' : 'left' }]}>{t.nameHint}</Text>
              </View>
            </View>

            <Field label={t.firstName} value={firstName} onChange={setFirstName}
              placeholder="أحمد" isRTL={isRTL}
              onLayout={(e: any) => { fieldOffsets.current['fn'] = e.nativeEvent.layout.y; }}
              onFocus={() => scrollToField('fn')} />
            <Field label={t.lastName} value={lastName} onChange={setLastName}
              placeholder="بن علي" isRTL={isRTL}
              onLayout={(e: any) => { fieldOffsets.current['ln'] = e.nativeEvent.layout.y; }}
              onFocus={() => scrollToField('ln')} />
            <Field label={t.email} value={email} onChange={setEmail}
              placeholder="example@gmail.com" keyboardType="email-address" isRTL={isRTL}
              onLayout={(e: any) => { fieldOffsets.current['em'] = e.nativeEvent.layout.y; }}
              onFocus={() => scrollToField('em')} />

            <View>
              <Text style={[s.sectionHint, { textAlign: isRTL ? 'right' : 'left' }]}>{t.phone}</Text>
              {/* رقم الهاتف يبقى دائماً LTR داخلياً (الأرقام تُقرأ دولياً من اليسار لليمين)، فقط ترتيب الحاوية يتغير */}
              <View
                style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', backgroundColor: '#2a2f3a', borderRadius: 10, overflow: 'hidden' }}
                onLayout={(e: any) => { fieldOffsets.current['ph'] = e.nativeEvent.layout.y; }}
              >
                <View style={{ paddingHorizontal: 14, paddingVertical: 14, backgroundColor: '#1f242e', flexDirection: 'row', alignItems: 'center' }}>
                  <Image
                    source={require('../../assets/images/algeria_flag.png')}
                    style={{ width: 26, height: 18, marginRight: 8, resizeMode: 'contain' }}
                  />
                  <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>+213</Text>
                </View>
                <TextInput
                  style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 14, color: '#fff', textAlign: 'left', writingDirection: 'ltr', fontSize: 16 }}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="552937123"
                  placeholderTextColor="#888"
                  keyboardType="phone-pad"
                  maxLength={9}
                  onFocus={() => scrollToField('ph')}
                />
              </View>
            </View>

            <Text style={[s.fieldHint, { textAlign: isRTL ? 'right' : 'left' }]}>{t.phoneHint}</Text>

            <TouchableOpacity style={s.btn} onPress={handleSendCode} disabled={loading}>
              {loading ? <ActivityIndicator color="#1F2A40" /> : <Text style={s.btnText}>{t.sendCode}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.linkBtn} onPress={() => router.push('/login-driver')}>
              <Text style={s.linkText}>{t.haveAccount}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══ خطوة 2: SMS حقيقي ══ */}
        {stage === 'verify_phone' && (
          <View style={s.centerBox}>
            <Text style={s.bigIcon}>📱</Text>
            <Text style={s.boxTitle}>{t.verifyTitle}</Text>
            <Text style={s.boxSub}>{t.verifySub}{phone}</Text>
            <TextInput
              style={s.codeInput}
              value={enteredCode}
              onChangeText={setEnteredCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor="#555"
            />
            <TouchableOpacity style={s.btn} onPress={verifyPhone} disabled={loading}>
              {loading ? <ActivityIndicator color="#1F2A40" /> : <Text style={s.btnText}>{t.confirmCode}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSendCode} style={{ marginTop: 14 }}>
              <Text style={s.linkText}>{t.resend}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ══ خطوة 3: كلمة المرور ══ */}
        {stage === 'password' && (
          <>
            <Field label={t.password} value={password} onChange={setPassword}
              placeholder="••••••" secure isRTL={isRTL}
              onLayout={(e: any) => { fieldOffsets.current['p1'] = e.nativeEvent.layout.y; }}
              onFocus={() => scrollToField('p1')} />
            <Field label={t.password2} value={password2} onChange={setPassword2}
              placeholder="••••••" secure isRTL={isRTL}
              onLayout={(e: any) => { fieldOffsets.current['p2'] = e.nativeEvent.layout.y; }}
              onFocus={() => scrollToField('p2')} />
            <View style={s.hintBox}><Text style={s.hintText}>{t.passHint}</Text></View>
            <TouchableOpacity style={s.btn} onPress={() => {
              if (password.length < 6)    { Alert.alert('خطأ', t.errPass);  return; }
              if (password !== password2) { Alert.alert('خطأ', t.errPass2); return; }
              setStage('docs');
            }}>
              <Text style={s.btnText}>{t.nextDocs}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══ خطوة 4: الصور ══ */}
        {stage === 'docs' && (
          <>
            <Text style={[s.docLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.selfieLabel}</Text>
            <View style={s.hintBox}><Text style={s.hintText}>{t.selfieHint}</Text></View>
            <TouchableOpacity style={[s.imgBox, selfieUri && s.imgBoxDone]} onPress={pickSelfie}>
              {selfieUri ? <Image source={{ uri: selfieUri }} style={s.imgPreview} />
                : <Text style={s.imgBoxTxt}>{t.selfieBtn}</Text>}
            </TouchableOpacity>

            <Text style={[s.docLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.licenseLabel}</Text>
            <TouchableOpacity style={[s.imgBox, licenseUri && s.imgBoxDone]} onPress={pickLicense}>
              {licenseUri ? <Image source={{ uri: licenseUri }} style={s.imgPreview} />
                : <Text style={s.imgBoxTxt}>{t.licenseBtn}</Text>}
            </TouchableOpacity>

            <Text style={[s.docLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.carteLabel}</Text>
            <TouchableOpacity style={[s.imgBox, carteGriseUri && s.imgBoxDone]} onPress={pickCarteGrise}>
              {carteGriseUri ? <Image source={{ uri: carteGriseUri }} style={s.imgPreview} />
                : <Text style={s.imgBoxTxt}>{t.carteBtn}</Text>}
            </TouchableOpacity>

            {loading
              ? <ActivityIndicator color="#E8B84B" size="large" style={{ marginTop: 20 }} />
              : <TouchableOpacity style={s.btn} onPress={registerFinal}>
                  <Text style={s.btnText}>{t.send}</Text>
                </TouchableOpacity>
            }
          </>
        )}

        {/* ══ خطوة 5: قيد المراجعة ══ */}
        {stage === 'pending' && (
          <View style={s.centerBox}>
            <Text style={s.bigIcon}>⏳</Text>
            <Text style={s.boxTitle}>{t.pendingTitle}</Text>
            <Text style={s.boxSub}>{t.pendingSub}</Text>
            <TouchableOpacity style={s.btn} onPress={() => router.replace('/')}>
              <Text style={s.btnText}>{t.home}</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── حقل إدخال موحّد الشكل ──
function Field({ label, value, onChange, placeholder, keyboardType, secure, isRTL, onLayout, onFocus }: any) {
  return (
    <View style={s.fieldWrap} onLayout={onLayout}>
      <Text style={[s.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{label}</Text>
      <TextInput
        style={s.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#666"
        keyboardType={keyboardType || 'default'}
        secureTextEntry={secure}
        textAlign={isRTL ? 'right' : 'left'}
        autoCapitalize="none"
        onFocus={onFocus}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#1a1f2e' },
  content:          { padding: 20, paddingBottom: 80 },
  header:           { flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 20, gap: 12 },
  backBtn:          { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  backBtnText:      { fontSize: 20, color: '#fff' },
  title:            { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  stepsRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  stepItem:         { flex: 1, alignItems: 'center', position: 'relative' },
  stepCircle:       { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  stepCircleActive: { backgroundColor: '#E8B84B' },
  stepNum:          { fontSize: 12, fontWeight: '900', color: '#666' },
  stepNumActive:    { color: '#1F2A40' },
  stepLabel:        { fontSize: 9, color: '#555', textAlign: 'center' },
  stepLabelActive:  { color: '#E8B84B' },
  stepLine:         { position: 'absolute', top: 14, left: '55%', right: '-55%', height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  stepLineActive:   { backgroundColor: '#E8B84B' },
  sectionHeader:    { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginBottom: 20, backgroundColor: 'rgba(232,184,75,0.1)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(232,184,75,0.3)' },
  sectionIcon:      { fontSize: 24 },
  sectionHint:      { fontSize: 12, color: '#E8B84B', textAlign: 'right', lineHeight: 18, flex: 1 },
  fieldWrap:        { marginBottom: 16 },
  fieldLabel:       { fontSize: 14, fontWeight: '600', color: '#ccc', textAlign: 'right', marginBottom: 8 },
  fieldInput:       { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 14, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  fieldHint:        { fontSize: 11, color: '#666', textAlign: 'right', marginTop: -10, marginBottom: 14 },
  hintBox:          { backgroundColor: 'rgba(232,184,75,0.1)', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(232,184,75,0.3)' },
  hintText:         { fontSize: 13, color: '#E8B84B', textAlign: 'right', lineHeight: 20 },
  btn:              { backgroundColor: '#E8B84B', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 8, elevation: 3 },
  btnText:          { fontSize: 16, fontWeight: 'bold', color: '#1F2A40' },
  linkBtn:          { marginTop: 16, alignItems: 'center' },
  linkText:         { color: '#E8B84B', fontSize: 14, textDecorationLine: 'underline', textAlign: 'center' },
  docLabel:         { fontSize: 15, fontWeight: 'bold', color: '#E8B84B', textAlign: 'right', marginBottom: 8, marginTop: 8 },
  imgBox:           { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', borderStyle: 'dashed', height: 160, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  imgBoxDone:       { borderColor: '#27ae60', borderStyle: 'solid' },
  imgBoxTxt:        { fontSize: 14, color: '#666', textAlign: 'center' },
  imgPreview:       { width: '100%', height: '100%', borderRadius: 12 },
  centerBox:        { alignItems: 'center', paddingTop: 30 },
  bigIcon:          { fontSize: 64, marginBottom: 16 },
  boxTitle:         { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  boxSub:           { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 24, lineHeight: 24 },
  codeInput:        { fontSize: 32, fontWeight: 'bold', color: '#fff', letterSpacing: 12, borderWidth: 2, borderColor: '#E8B84B', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginBottom: 20, width: 220, textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
});

