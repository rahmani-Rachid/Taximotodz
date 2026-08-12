import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { GoogleAuthProvider, createUserWithEmailAndPassword, sendEmailVerification, signInWithCredential } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView,
  Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { registerForPushNotificationsAsync } from '../constants/pushNotifications';
import { useLanguage } from '../contexts/LanguageContext';
import { auth, db, storage } from '../utils/firebase';

const GOOGLE_WEB_CLIENT_ID = '1026634729182-rdfcpch5fr23r8lscr0lcim7as4mfq8a.apps.googleusercontent.com';

GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

type Lang  = 'ar' | 'fr' | 'en';
type Stage = 'choice' | 'emailForm' | 'phone' | 'name' | 'docs' | 'pending';

const T: Record<Lang, Record<string, string>> = {
  ar: {
    title:          'تسجيل سائق 🏍️',
    googleBtn:      'المتابعة بحساب Google',
    orDivider:      'أو',
    emailToggle:    'التسجيل بالبريد الإلكتروني',
    email:          'البريد الإلكتروني',
    password:       'كلمة المرور',
    password2:      'تأكيد كلمة المرور',
    emailSubmit:    'إنشاء الحساب',
    phone:          'رقم الهاتف',
    phoneConfirm:   'أعد كتابة رقم الهاتف للتأكيد',
    phoneNext:      'التالي ←',
    nameHint:       'يجب أن يتطابق الاسم واللقب مع رخصة السياقة',
    firstName:      'الاسم',
    lastName:       'اللقب',
    nameNext:       'التالي — الوثائق ←',
    licenseLabel:   '📄 رخصة السياقة للدراجة',
    licenseBtn:     'اضغط لتصوير رخصة السياقة 📷',
    carteLabel:     '🏍️ البطاقة الرمادية (Carte Grise)',
    carteBtn:       'اضغط لتصوير البطاقة الرمادية 📷',
    selfieLabel:    '🤳 صورة شخصية (سيلفي)',
    selfieHint:     '⚠️ هذه الصورة ستكون صورة ملفك الشخصي الثابتة، ولا يمكن تغييرها لاحقاً — تأكد أنها واضحة ووجهك ظاهر بالكامل',
    selfieBtn:      'اضغط لالتقاط سيلفي 📷',
    send:           'إرسال الطلب ✓',
    pendingTitle:   'طلبك قيد المراجعة',
    pendingSub:     'تم استلام وثائقك بنجاح.\nسنراجعها خلال 24 ساعة\nوسيصلك إشعار عند القبول.',
    home:           'العودة للرئيسية 🏠',
    haveAccount:    'لديك حساب؟ سجل الدخول',
    errEmail:       'البريد الإلكتروني غير صحيح',
    errPass:        'كلمة المرور 6 أحرف على الأقل',
    errPass2:       'كلمتا المرور غير متطابقتان',
    errPhone:       'أدخل رقم الهاتف بشكل صحيح (9 أرقام، يبدأ بـ 5 أو 6 أو 7)',
    errPhoneMatch:  'الرقمان غير متطابقين، تحقق مرة أخرى',
    errFirst:       'أدخل الاسم',
    errLast:        'أدخل اللقب',
    errSelfie:      'يجب التقاط السيلفي',
    errLicense:     'يجب تصوير رخصة السياقة',
    errCarte:       'يجب تصوير البطاقة الرمادية',
    errGeneric:     'حدث خطأ ما، حاول مجدداً',
    errTitle:       'خطأ',
    verifyEmailSent:'تم إنشاء الحساب! أرسلنا رابط تحقق إلى بريدك الإلكتروني.',
  },
  fr: {
    title:          'Inscription chauffeur 🏍️',
    googleBtn:      'Continuer avec Google',
    orDivider:      'ou',
    emailToggle:    "S'inscrire par e-mail",
    email:          'Email',
    password:       'Mot de passe',
    password2:      'Confirmer le mot de passe',
    emailSubmit:    'Créer le compte',
    phone:          'Numéro de téléphone',
    phoneConfirm:   'Retapez le numéro pour confirmer',
    phoneNext:      'Suivant →',
    nameHint:       'Le prénom et le nom doivent correspondre au permis de conduire',
    firstName:      'Prénom',
    lastName:       'Nom',
    nameNext:       'Suivant — Documents →',
    licenseLabel:   '📄 Permis de conduire moto',
    licenseBtn:     'Appuyez pour photographier le permis 📷',
    carteLabel:     '🏍️ Carte grise de la moto',
    carteBtn:       'Appuyez pour photographier la carte grise 📷',
    selfieLabel:    '🤳 Photo personnelle (selfie)',
    selfieHint:     '⚠️ Cette photo sera votre photo de profil définitive et ne pourra pas être modifiée plus tard — assurez-vous que votre visage est bien visible',
    selfieBtn:      'Appuyez pour prendre un selfie 📷',
    send:           'Envoyer la demande ✓',
    pendingTitle:   'Votre demande est en cours',
    pendingSub:     'Vos documents ont été reçus.\nNous les examinerons dans 24h\nVous recevrez une notification.',
    home:           "Retour à l'accueil 🏠",
    haveAccount:    'Vous avez un compte ? Connectez-vous',
    errEmail:       'Email invalide',
    errPass:        'Le mot de passe doit avoir 6 caractères minimum',
    errPass2:       'Les mots de passe ne correspondent pas',
    errPhone:       'Entrez un numéro valide (9 chiffres, commence par 5, 6 ou 7)',
    errPhoneMatch:  'Les numéros ne correspondent pas, vérifiez à nouveau',
    errFirst:       'Entrez le prénom',
    errLast:        'Entrez le nom',
    errSelfie:      'Veuillez prendre un selfie',
    errLicense:     'Veuillez photographier le permis',
    errCarte:       'Veuillez photographier la carte grise',
    errGeneric:     'Une erreur est survenue, réessayez',
    errTitle:       'Erreur',
    verifyEmailSent:'Compte créé ! Un lien de vérification a été envoyé à votre e-mail.',
  },
  en: {
    title:          'Driver Registration 🏍️',
    googleBtn:      'Continue with Google',
    orDivider:      'or',
    emailToggle:    'Sign up with email',
    email:          'Email',
    password:       'Password',
    password2:      'Confirm Password',
    emailSubmit:    'Create account',
    phone:          'Phone Number',
    phoneConfirm:   'Re-enter the number to confirm',
    phoneNext:      'Next →',
    nameHint:       'First and last name must match your driving license',
    firstName:      'First Name',
    lastName:       'Last Name',
    nameNext:       'Next — Documents →',
    licenseLabel:   '📄 Motorcycle Driving License',
    licenseBtn:     'Tap to photograph the license 📷',
    carteLabel:     '🏍️ Vehicle Registration Card',
    carteBtn:       'Tap to photograph the registration card 📷',
    selfieLabel:    '🤳 Personal Photo (Selfie)',
    selfieHint:     '⚠️ This photo will be your permanent profile picture and cannot be changed later — make sure your face is fully visible',
    selfieBtn:      'Tap to take a selfie 📷',
    send:           'Submit Application ✓',
    pendingTitle:   'Your request is under review',
    pendingSub:     'Your documents have been received.\nWe will review them within 24 hours.\nYou will be notified upon approval.',
    home:           'Back to Home 🏠',
    haveAccount:    'Have an account? Sign in',
    errEmail:       'Invalid email address',
    errPass:        'Password must be at least 6 characters',
    errPass2:       'Passwords do not match',
    errPhone:       'Enter a valid number (9 digits, starts with 5, 6, or 7)',
    errPhoneMatch:  'The numbers do not match, check again',
    errFirst:       'Enter first name',
    errLast:        'Enter last name',
    errSelfie:      'Please take a selfie',
    errLicense:     'Please photograph the license',
    errCarte:       'Please photograph the registration card',
    errGeneric:     'Something went wrong, try again',
    errTitle:       'Error',
    verifyEmailSent:'Account created! A verification link was sent to your email.',
  },
};

export default function RegisterDriver() {
  const router    = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const { lang } = useLanguage();
  const [stage,   setStage]   = useState<Stage>('choice');
  const [loading, setLoading] = useState(false);

  // بيانات المستخدم (تأتي من Google أو تُنشأ بالبريد)
  const [uid, setUid]     = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [viaEmail, setViaEmail] = useState(false);

  // نموذج البريد
  const [emailInput,    setEmailInput]    = useState('');
  const [password,      setPassword]      = useState('');
  const [password2,     setPassword2]     = useState('');

  // الهاتف
  const [phone,        setPhone]        = useState('');
  const [phoneConfirm, setPhoneConfirm] = useState('');

  // الاسم
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');

  // الوثائق
  const [licenseUri,    setLicenseUri]    = useState<string | null>(null);
  const [carteGriseUri, setCarteGriseUri] = useState<string | null>(null);
  const [selfieUri,     setSelfieUri]     = useState<string | null>(null);

  const t = T[lang];
  const isRTL = lang === 'ar';

  const handleGooglePress = async () => {
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken;
      await handleGoogleSuccess(idToken || undefined);
    } catch (e: any) {
      if (e.code !== 'SIGN_IN_CANCELLED' && e.code !== '-5') {
        Alert.alert(t.errTitle, t.errGeneric);
      }
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (idToken: string | undefined) => {
    if (!idToken) { Alert.alert(t.errTitle, t.errGeneric); return; }
    setLoading(true);
    try {
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      setUid(result.user.uid);
      setEmail(result.user.email || '');
      setViaEmail(false);

      // تعبئة الاسم تلقائياً كنقطة انطلاق — يبقى قابلاً للتعديل في خطوة لاحقة (يجب أن يطابق الرخصة)
      const displayName = result.user.displayName || '';
      const parts = displayName.trim().split(' ');
      setFirstName(parts[0] || '');
      setLastName(parts.slice(1).join(' ') || '');

      setStage('phone');
    } catch (e: any) {
      Alert.alert(t.errTitle, e.message || t.errGeneric);
    }
    setLoading(false);
  };

  const handleEmailSignup = async () => {
    if (!/\S+@\S+\.\S+/.test(emailInput.trim())) { Alert.alert(t.errTitle, t.errEmail); return; }
    if (password.length < 6) { Alert.alert(t.errTitle, t.errPass); return; }
    if (password !== password2) { Alert.alert(t.errTitle, t.errPass2); return; }

    setLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, emailInput.trim(), password);
      sendEmailVerification(result.user).catch(() => {});
      setUid(result.user.uid);
      setEmail(emailInput.trim());
      setViaEmail(true);
      setStage('phone');
    } catch (e: any) {
      Alert.alert(t.errTitle, e.message || t.errGeneric);
    }
    setLoading(false);
  };

  const handlePhoneNext = () => {
    if (!/^[5-7][0-9]{8}$/.test(phone.trim())) { Alert.alert(t.errTitle, t.errPhone); return; }
    if (phone.trim() !== phoneConfirm.trim()) { Alert.alert(t.errTitle, t.errPhoneMatch); return; }

    const alertTitle = isRTL ? '⚠️ تنبيه مهم' : (lang === 'fr' ? '⚠️ Attention importante' : '⚠️ Important notice');

    const alertMessage = viaEmail
      ? (isRTL
          ? 'تأكد من كتابة الاسم واللقب بالضبط كما يظهران في رخصة السياقة الخاصة بك.'
          : (lang === 'fr'
              ? 'Assurez-vous de saisir le prénom et le nom exactement comme ils apparaissent sur votre permis de conduire.'
              : 'Make sure to enter your first and last name exactly as they appear on your driving license.'))
      : (isRTL
          ? 'الاسم الظاهر من حساب Google قد يكون اسماً مستعاراً أو مختلفاً عن هويتك الحقيقية. تأكد من تعديله في الخطوة التالية ليطابق رخصة السياقة بدقة تامة.'
          : (lang === 'fr'
              ? 'Le nom affiché par Google peut être un pseudonyme différent de votre identité réelle. Assurez-vous de le corriger à l\'étape suivante pour qu\'il corresponde exactement à votre permis de conduire.'
              : 'The name shown by Google may be a nickname different from your real identity. Make sure to correct it in the next step to exactly match your driving license.'));

    Alert.alert(alertTitle, alertMessage);
    setStage('name');
  };

  const handleNameNext = () => {
    if (!firstName.trim()) { Alert.alert(t.errTitle, t.errFirst); return; }
    if (!lastName.trim())  { Alert.alert(t.errTitle, t.errLast);  return; }
    setStage('docs');
  };

  const pickLicense = async () => {
    const res = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.back, quality: 0.85 });
    if (!res.canceled) setLicenseUri(res.assets[0].uri);
  };
  const pickCarteGrise = async () => {
    const res = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.back, quality: 0.85 });
    if (!res.canceled) setCarteGriseUri(res.assets[0].uri);
  };
  const pickSelfie = async () => {
    const res = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: 0.85 });
    if (!res.canceled) setSelfieUri(res.assets[0].uri);
  };

  const uploadImage = async (uri: string, driverUid: string, fileName: string): Promise<string> => {
    const r = ref(storage, `drivers/${driverUid}/${fileName}`);
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

  const registerFinal = async () => {
    if (!licenseUri)    { Alert.alert(t.errTitle, t.errLicense); return; }
    if (!carteGriseUri) { Alert.alert(t.errTitle, t.errCarte);   return; }
    if (!selfieUri)     { Alert.alert(t.errTitle, t.errSelfie);  return; }
    if (!uid) return;

    setLoading(true);
    try {
      const [licenseUrl, carteGriseUrl, selfieUrl] = await Promise.all([
        uploadImage(licenseUri,    uid, 'license.jpg'),
        uploadImage(carteGriseUri, uid, 'carte_grise.jpg'),
        uploadImage(selfieUri,     uid, 'selfie.jpg'),
      ]);

      await setDoc(doc(db, 'drivers', uid), {
        name:       `${firstName.trim()} ${lastName.trim()}`,
        firstName:  firstName.trim(),
        lastName:   lastName.trim(),
        email,
        phone:      '+213' + phone.trim(),
        licenseUrl, carteGriseUrl, selfieUrl,
        photoURL:   selfieUrl, // السيلفي = صورة البروفايل الثابتة، لا تتغيّر لاحقاً
        role:       'driver',
        kyc_status: 'pending',
        isOnline:   false,
        rating:     0,
        totalTrips: 0,
        createdAt:  serverTimestamp(),
      });

      await registerForPushNotificationsAsync('drivers');

      if (viaEmail) {
        Alert.alert(isRTL ? 'معلومة' : 'Info', t.verifyEmailSent);
      }

      setStage('pending');
    } catch (e: any) {
      Alert.alert(t.errTitle, e.message || t.errGeneric);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={20}>

      <ScrollView ref={scrollRef} style={s.container}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>

        <View style={[s.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>{isRTL ? '→' : '←'}</Text>
          </TouchableOpacity>
          <Text style={s.title}>{t.title}</Text>
        </View>

        {/* ══ خطوة 1: Google أو بريد ══ */}
        {stage === 'choice' && (
          <>
            <TouchableOpacity
              style={s.googleBtn}
              onPress={handleGooglePress}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#1F2A40" />
              ) : (
                <>
                  <Image source={{ uri: 'https://www.google.com/favicon.ico' }} style={s.googleIcon} />
                  <Text style={s.googleBtnText}>{t.googleBtn}</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={s.dividerRow}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>{t.orDivider}</Text>
              <View style={s.dividerLine} />
            </View>

            <TouchableOpacity onPress={() => setStage('emailForm')}>
              <Text style={s.linkText}>{t.emailToggle}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.linkBtn} onPress={() => router.push('/login-driver')}>
              <Text style={s.linkText}>{t.haveAccount}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══ خطوة 1ب: نموذج البريد ══ */}
        {stage === 'emailForm' && (
          <>
            <Field label={t.email} value={emailInput} onChange={setEmailInput}
              placeholder="example@gmail.com" keyboardType="email-address" isRTL={isRTL} />
            <Field label={t.password} value={password} onChange={setPassword}
              placeholder="••••••" secure isRTL={isRTL} />
            <Field label={t.password2} value={password2} onChange={setPassword2}
              placeholder="••••••" secure isRTL={isRTL} />

            <TouchableOpacity style={s.btn} onPress={handleEmailSignup} disabled={loading}>
              {loading ? <ActivityIndicator color="#1F2A40" /> : <Text style={s.btnText}>{t.emailSubmit}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStage('choice')}>
              <Text style={s.linkText}>{isRTL ? '→' : '←'} {t.googleBtn}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══ خطوة 2: الهاتف ══ */}
        {stage === 'phone' && (
          <>
            <View>
              <Text style={[s.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.phone}</Text>
              <View style={s.phoneContainer}>
                <View style={s.flagBox}>
                  <Image source={require('../../assets/images/algeria_flag.png')} style={s.flagImg} />
                  <Text style={s.flagText}>+213</Text>
                </View>
                <TextInput
                  style={s.phoneInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="552937123"
                  placeholderTextColor="#888"
                  keyboardType="phone-pad"
                  maxLength={9}
                />
              </View>
            </View>

            <View style={{ marginTop: 16 }}>
              <Text style={[s.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.phoneConfirm}</Text>
              <View style={s.phoneContainer}>
                <View style={s.flagBox}>
                  <Text style={s.flagText}>+213</Text>
                </View>
                <TextInput
                  style={s.phoneInput}
                  value={phoneConfirm}
                  onChangeText={setPhoneConfirm}
                  placeholder="552937123"
                  placeholderTextColor="#888"
                  keyboardType="phone-pad"
                  maxLength={9}
                />
              </View>
            </View>

            <TouchableOpacity style={s.btn} onPress={handlePhoneNext}>
              <Text style={s.btnText}>{t.phoneNext}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══ خطوة 3: الاسم واللقب ══ */}
        {stage === 'name' && (
          <>
            <View style={s.hintBox}><Text style={s.hintText}>{t.nameHint}</Text></View>

            <Field label={t.firstName} value={firstName} onChange={setFirstName}
              placeholder="أحمد" isRTL={isRTL} />
            <Field label={t.lastName} value={lastName} onChange={setLastName}
              placeholder="بن علي" isRTL={isRTL} />

            <TouchableOpacity style={s.btn} onPress={handleNameNext}>
              <Text style={s.btnText}>{t.nameNext}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══ خطوة 4: الوثائق ══ */}
        {stage === 'docs' && (
          <>
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

            <Text style={[s.docLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.selfieLabel}</Text>
            <View style={s.hintBox}><Text style={s.hintText}>{t.selfieHint}</Text></View>
            <TouchableOpacity style={[s.imgBox, selfieUri && s.imgBoxDone]} onPress={pickSelfie}>
              {selfieUri ? <Image source={{ uri: selfieUri }} style={s.imgPreview} />
                : <Text style={s.imgBoxTxt}>{t.selfieBtn}</Text>}
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

function Field({ label, value, onChange, placeholder, keyboardType, secure, isRTL }: any) {
  return (
    <View style={s.fieldWrap}>
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
  googleBtn: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  googleIcon: { width: 22, height: 22, marginRight: 10 },
  googleBtnText: { fontSize: 16, fontWeight: '700', color: '#1F2A40' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  dividerText: { marginHorizontal: 12, color: '#ccc', fontWeight: '600' },
  fieldWrap:        { marginBottom: 16 },
  fieldLabel:       { fontSize: 14, fontWeight: '600', color: '#ccc', marginBottom: 8 },
  fieldInput:       { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 14, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  phoneContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2a2f3a',
    borderRadius: 10, overflow: 'hidden',
  },
  flagBox: { paddingHorizontal: 14, paddingVertical: 14, backgroundColor: '#1f242e', flexDirection: 'row', alignItems: 'center' },
  flagImg: { width: 26, height: 18, marginRight: 8, resizeMode: 'contain' },
  flagText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  phoneInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 14, color: '#fff', textAlign: 'left', writingDirection: 'ltr', fontSize: 16 },
  hintBox:          { backgroundColor: 'rgba(232,184,75,0.1)', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(232,184,75,0.3)' },
  hintText:         { fontSize: 13, color: '#E8B84B', textAlign: 'right', lineHeight: 20 },
  btn:              { backgroundColor: '#E8B84B', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 20, elevation: 3 },
  btnText:          { fontSize: 16, fontWeight: 'bold', color: '#1F2A40' },
  linkBtn:          { marginTop: 16, alignItems: 'center' },
  linkText:         { color: '#E8B84B', fontSize: 14, textDecorationLine: 'underline', textAlign: 'center' },
  docLabel:         { fontSize: 15, fontWeight: 'bold', color: '#E8B84B', marginBottom: 8, marginTop: 8 },
  imgBox:           { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', borderStyle: 'dashed', height: 160, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  imgBoxDone:       { borderColor: '#27ae60', borderStyle: 'solid' },
  imgBoxTxt:        { fontSize: 14, color: '#666', textAlign: 'center' },
  imgPreview:       { width: '100%', height: '100%', borderRadius: 12 },
  centerBox:        { alignItems: 'center', paddingTop: 30 },
  bigIcon:          { fontSize: 64, marginBottom: 16 },
  boxTitle:         { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  boxSub:           { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 24, lineHeight: 24 },
});

