import { makeRedirectUri } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { GoogleAuthProvider, createUserWithEmailAndPassword, sendEmailVerification, signInWithCredential } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { Lang, useLanguage } from '../contexts/LanguageContext';
import { auth, db } from '../utils/firebase';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_ANDROID_CLIENT_ID = '1026634729182-l11dvakm05tn3uk1575a38ljbmpg2uhq.apps.googleusercontent.com';
const GOOGLE_WEB_CLIENT_ID     = '1026634729182-rdfcpch5fr23r8lscr0lcim7as4mfq8a.apps.googleusercontent.com';

const translations: Record<Lang, Record<string, string>> = {
  ar: {
    title:          'إنشاء حساب زبون',
    subtitle:       'سجّل دخولك بحساب Google للبدء',
    googleBtn:      'المتابعة بحساب Google',
    orDivider:      'أو',
    emailToggle:    'التسجيل بالبريد الإلكتروني',
    name:           'الاسم الكامل',
    namePlaceholder:'مثال: أحمد بن علي',
    email:          'البريد الإلكتروني',
    password:       'كلمة المرور',
    passwordPh:     'أحرف على الأقل 6',
    confirmPass:    'تأكيد كلمة المرور',
    confirmPassPh:  'أعد كتابة كلمة المرور',
    emailSubmitBtn: 'إنشاء الحساب',
    phoneTitle:     'أدخل رقم هاتفك',
    phoneSubtitle:  'مطلوب حتى يتواصل معك السائق مباشرة',
    phone:          'رقم الهاتف',
    phoneConfirm:   'أعد كتابة رقم الهاتف للتأكيد',
    confirmBtn:     'تأكيد وإنشاء الحساب',
    errName:        'الرجاء إدخال الاسم الكامل',
    errEmail:       'البريد الإلكتروني غير صالح',
    errPassShort:   'كلمة المرور قصيرة جداً',
    errPassMatch:   'كلمتا المرور غير متطابقتين',
    errPhone:       'رقم الهاتف غير صالح، يجب أن يتكون من 9 أرقام ويبدأ بـ 5 أو 6 أو 7',
    errPhoneMatch:  'الرقمان غير متطابقين، تحقق مرة أخرى',
    errTitle:       'خطأ',
    errGeneric:     'حدث خطأ ما، حاول مجدداً',
    verifyEmailSent:'تم إنشاء الحساب! أرسلنا رابط تحقق إلى بريدك الإلكتروني — يُستحسن فتحه لتأكيد بريدك.',
    haveAccount:    'لديك حساب؟ سجل الدخول',
  },
  fr: {
    title:          'Créer un compte client',
    subtitle:       'Connectez-vous avec Google pour commencer',
    googleBtn:      'Continuer avec Google',
    orDivider:      'ou',
    emailToggle:    "S'inscrire par e-mail",
    name:           'Nom complet',
    namePlaceholder:'Ex : Ahmed Benali',
    email:          'Adresse e-mail',
    password:       'Mot de passe',
    passwordPh:     '6 caractères minimum',
    confirmPass:    'Confirmer le mot de passe',
    confirmPassPh:  'Retapez le mot de passe',
    emailSubmitBtn: 'Créer le compte',
    phoneTitle:     'Entrez votre numéro de téléphone',
    phoneSubtitle:  'Requis pour que le chauffeur vous contacte directement',
    phone:          'Numéro de téléphone',
    phoneConfirm:   'Retapez le numéro pour confirmer',
    confirmBtn:     'Confirmer et créer le compte',
    errName:        'Veuillez entrer votre nom complet',
    errEmail:       'Adresse e-mail invalide',
    errPassShort:   'Mot de passe trop court',
    errPassMatch:   'Les mots de passe ne correspondent pas',
    errPhone:       'Numéro invalide, il doit contenir 9 chiffres et commencer par 5, 6 ou 7',
    errPhoneMatch:  'Les numéros ne correspondent pas, vérifiez à nouveau',
    errTitle:       'Erreur',
    errGeneric:     "Une erreur est survenue, réessayez",
    verifyEmailSent:'Compte créé ! Un lien de vérification a été envoyé à votre e-mail.',
    haveAccount:    'Vous avez un compte ? Connectez-vous',
  },
  en: {
    title:          'Create customer account',
    subtitle:       'Sign in with Google to get started',
    googleBtn:      'Continue with Google',
    orDivider:      'or',
    emailToggle:    'Sign up with email',
    name:           'Full name',
    namePlaceholder:'e.g. Ahmed Benali',
    email:          'Email address',
    password:       'Password',
    passwordPh:     'At least 6 characters',
    confirmPass:    'Confirm password',
    confirmPassPh:  'Re-enter your password',
    emailSubmitBtn: 'Create account',
    phoneTitle:     'Enter your phone number',
    phoneSubtitle:  'Required so the driver can contact you directly',
    phone:          'Phone number',
    phoneConfirm:   'Re-enter the number to confirm',
    confirmBtn:     'Confirm and create account',
    errName:        'Please enter your full name',
    errEmail:       'Invalid email address',
    errPassShort:   'Password is too short',
    errPassMatch:   'Passwords do not match',
    errPhone:       'Invalid phone number, it must be 9 digits and start with 5, 6, or 7',
    errPhoneMatch:  'The numbers do not match, check again',
    errTitle:       'Error',
    errGeneric:     'Something went wrong, try again',
    verifyEmailSent:'Account created! A verification link was sent to your email.',
    haveAccount:    'Already have an account? Log in',
  },
};

type Step = 'choice' | 'emailForm' | 'phone';

export default function SignupCustomer() {
  const router = useRouter();
  const { lang } = useLanguage();
  const T = translations[lang];
  const isRTL = lang === 'ar';

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('choice');
  const [pendingUser, setPendingUser] = useState<{ uid: string; name: string; email: string; photoURL: string | null; viaEmail: boolean } | null>(null);

  // حقول التسجيل بالبريد
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // حقول رقم الهاتف (مشتركة بين المسارين)
  const [phone, setPhone] = useState('');
  const [phoneConfirm, setPhoneConfirm] = useState('');

  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    redirectUri: makeRedirectUri({ scheme: 'taximotodz' }),
  });

  useEffect(() => {
    if (response?.type === 'success') {
      handleGoogleSuccess(response.authentication?.idToken);
    } else if (response?.type === 'error') {
      Alert.alert(T.errTitle, T.errGeneric);
    }
  }, [response]);

  const handleGoogleSuccess = async (idToken: string | undefined) => {
    if (!idToken) {
      Alert.alert(T.errTitle, T.errGeneric);
      return;
    }
    setLoading(true);
    try {
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      const uid = result.user.uid;

      const existingDoc = await getDoc(doc(db, 'users', uid));
      if (existingDoc.exists()) {
        router.replace('/app-customer');
        return;
      }

      setPendingUser({
        uid,
        name: result.user.displayName || '',
        email: result.user.email || '',
        photoURL: result.user.photoURL || null,
        viaEmail: false,
      });
      setStep('phone');
    } catch (e: any) {
      Alert.alert(T.errTitle, e.message || T.errGeneric);
    }
    setLoading(false);
  };

  const handleEmailSignup = async () => {
    if (!name.trim()) { Alert.alert(T.errTitle, T.errName); return; }
    if (!/\S+@\S+\.\S+/.test(email.trim())) { Alert.alert(T.errTitle, T.errEmail); return; }
    if (password.length < 6) { Alert.alert(T.errTitle, T.errPassShort); return; }
    if (password !== confirmPassword) { Alert.alert(T.errTitle, T.errPassMatch); return; }

    setLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, email.trim(), password);

      // إرسال رابط تحقق حقيقي للبريد الإلكتروني — لا يمنع المتابعة، فقط إعلامي
      sendEmailVerification(result.user).catch(() => {});

      setPendingUser({
        uid: result.user.uid,
        name: name.trim(),
        email: email.trim(),
        photoURL: null,
        viaEmail: true,
      });
      setStep('phone');
    } catch (e: any) {
      Alert.alert(T.errTitle, e.message || T.errGeneric);
    }
    setLoading(false);
  };

  const handleConfirmPhone = async () => {
    if (!/^[5-7][0-9]{8}$/.test(phone.trim())) {
      Alert.alert(T.errTitle, T.errPhone);
      return;
    }
    if (phone.trim() !== phoneConfirm.trim()) {
      Alert.alert(T.errTitle, T.errPhoneMatch);
      return;
    }
    if (!pendingUser) return;

    setLoading(true);
    try {
      await setDoc(doc(db, 'users', pendingUser.uid), {
        name: pendingUser.name,
        email: pendingUser.email,
        phone: '+213' + phone.trim(),
        role: 'customer',
        photoURL: pendingUser.photoURL,
        createdAt: serverTimestamp(),
      });

      if (pendingUser.viaEmail) {
        Alert.alert(isRTL ? 'معلومة' : 'Info', T.verifyEmailSent);
      }

      router.replace('/app-customer');
    } catch (e: any) {
      Alert.alert(T.errTitle, e.message || T.errGeneric);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#E8B84B' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">

        <Text style={s.emoji}>👤</Text>
        <Text style={s.title}>{T.title}</Text>

        {step === 'choice' && (
          <>
            <Text style={s.subtitle}>{T.subtitle}</Text>

            <TouchableOpacity
              style={s.googleBtn}
              onPress={() => promptAsync()}
              disabled={!request || loading}
            >
              {loading ? (
                <ActivityIndicator color="#1F2A40" />
              ) : (
                <>
                  <Image
                    source={{ uri: 'https://www.google.com/favicon.ico' }}
                    style={s.googleIcon}
                  />
                  <Text style={s.googleBtnText}>{T.googleBtn}</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={s.dividerRow}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>{T.orDivider}</Text>
              <View style={s.dividerLine} />
            </View>

            <TouchableOpacity onPress={() => setStep('emailForm')}>
              <Text style={s.emailToggleText}>{T.emailToggle}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'emailForm' && (
          <>
            <View style={s.inputWrap}>
              <Text style={[s.label, { textAlign: isRTL ? 'right' : 'left' }]}>{T.name}</Text>
              <TextInput
                style={[s.input, { textAlign: isRTL ? 'right' : 'left' }]}
                value={name}
                onChangeText={setName}
                placeholder={T.namePlaceholder}
                placeholderTextColor="#bbb"
              />
            </View>

            <View style={s.inputWrap}>
              <Text style={[s.label, { textAlign: isRTL ? 'right' : 'left' }]}>{T.email}</Text>
              <TextInput
                style={[s.input, { textAlign: 'left', writingDirection: 'ltr' }]}
                value={email}
                onChangeText={setEmail}
                placeholder="example@email.com"
                placeholderTextColor="#bbb"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={s.inputWrap}>
              <Text style={[s.label, { textAlign: isRTL ? 'right' : 'left' }]}>{T.password}</Text>
              <TextInput
                style={[s.input, { textAlign: isRTL ? 'right' : 'left' }]}
                value={password}
                onChangeText={setPassword}
                placeholder={T.passwordPh}
                placeholderTextColor="#bbb"
                secureTextEntry
              />
            </View>

            <View style={s.inputWrap}>
              <Text style={[s.label, { textAlign: isRTL ? 'right' : 'left' }]}>{T.confirmPass}</Text>
              <TextInput
                style={[s.input, { textAlign: isRTL ? 'right' : 'left' }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={T.confirmPassPh}
                placeholderTextColor="#bbb"
                secureTextEntry
              />
            </View>

            <TouchableOpacity style={s.submitBtn} onPress={handleEmailSignup} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#E8B84B" />
              ) : (
                <Text style={s.submitBtnText}>{T.emailSubmitBtn}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('choice')}>
              <Text style={s.emailToggleText}>← {T.googleBtn}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'phone' && (
          <>
            <Text style={s.subtitle}>{T.phoneTitle}</Text>
            <Text style={[s.subtitle, { fontSize: 12, marginTop: -12 }]}>{T.phoneSubtitle}</Text>

            <View style={s.inputWrap}>
              <Text style={[s.label, { textAlign: isRTL ? 'right' : 'left' }]}>{T.phone}</Text>
              <View style={s.phoneContainer}>
                <View style={s.flagBox}>
                  <Image
                    source={require('../../assets/images/algeria_flag.png')}
                    style={s.flagImg}
                  />
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

            <View style={s.inputWrap}>
              <Text style={[s.label, { textAlign: isRTL ? 'right' : 'left' }]}>{T.phoneConfirm}</Text>
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

            <TouchableOpacity style={s.submitBtn} onPress={handleConfirmPhone} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#E8B84B" />
              ) : (
                <Text style={s.submitBtnText}>{T.confirmBtn}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => router.push('/login')}>
          <Text style={s.loginLink}>{T.haveAccount}</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scrollContent: { padding: 24, paddingTop: 80, paddingBottom: 220 },
  emoji: { fontSize: 48, textAlign: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '900', color: '#1F2A40', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#1F2A40', textAlign: 'center', marginBottom: 24, opacity: 0.8 },
  googleBtn: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#d4a537',
  },
  googleIcon: { width: 22, height: 22, marginRight: 10 },
  googleBtnText: { fontSize: 16, fontWeight: '700', color: '#1F2A40' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#d4a537' },
  dividerText: { marginHorizontal: 12, color: '#1F2A40', fontWeight: '600' },
  emailToggleText: { fontSize: 14, color: '#1F2A40', textAlign: 'center', fontWeight: '700', textDecorationLine: 'underline' },
  inputWrap: { marginBottom: 16, marginTop: 8 },
  label: { fontSize: 13, fontWeight: '700', color: '#1F2A40', marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: '#d4a537', color: '#000' },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d4a537'
  },
  flagBox: { paddingHorizontal: 14, paddingVertical: 14, backgroundColor: '#f3e5ab', flexDirection: 'row', alignItems: 'center' },
  flagImg: { width: 26, height: 18, marginRight: 8, resizeMode: 'contain' },
  flagText: { color: '#1F2A40', fontWeight: 'bold', fontSize: 16 },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
    color: '#000',
    textAlign: 'left',
    writingDirection: 'ltr',
    fontSize: 16
  },
  submitBtn: { backgroundColor: '#1F2A40', borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { fontSize: 16, fontWeight: '900', color: '#E8B84B', textAlign: 'center' },
  loginLink: { fontSize: 13, color: '#1F2A40', textAlign: 'center', marginTop: 24, fontWeight: '600' },
});

