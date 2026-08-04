import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useState } from 'react';
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
import { auth, db, functions } from '../utils/firebase';

const translations: Record<Lang, Record<string, string>> = {
  ar: {
    title: 'إنشاء حساب زبون',
    subtitle: 'سجل بياناتك وتحقق من رقم هاتفك للبدء',
    name: 'الاسم الكامل',
    namePlaceholder: 'مثال: أحمد بن علي',
    phone: 'رقم الهاتف',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    passwordPh: 'أحرف على الأقل 6',
    confirmPass: 'تأكيد كلمة المرور',
    confirmPassPh: 'أعد كتابة كلمة المرور',
    sendOtp: 'إرسال رمز التحقق (WhatsApp)',
    otpLabel: 'أدخل رمز التحقق (WhatsApp)',
    verifyBtn: 'تأكيد الرمز وإنشاء الحساب',
    reenterPhone: 'إعادة إدخال رقم الهاتف',
    haveAccount: 'لديك حساب؟ سجل الدخول',
    errName: 'الرجاء إدخال الاسم الكامل',
    errPhone: 'رقم الهاتف غير صالح، يجب أن يتكون من 9 أرقام ويبدأ بـ 5 أو 6 أو 7',
    errEmail: 'البريد الإلكتروني غير صالح',
    errPassShort: 'كلمة المرور قصيرة جداً',
    errPassMatch: 'كلمتا المرور غير متطابقتين',
    errOtpLen: 'الرجاء إدخال رمز التحقق المكون من 6 أرقام بشكل صحيح',
    errOtpWrong: 'رمز التحقق غير صحيح',
    errGeneric: 'حدث خطأ ما، حاول مجدداً',
    sentTitle: 'تم الإرسال',
    sentMsg: 'تم إرسال رمز التحقق إلى رقم هاتفك عبر WhatsApp.',
    errSendTitle: 'خطأ في إرسال الرمز',
    errSendMsg: 'تعذر إرسال رمز التحقق، تأكد من صحة الرقم.',
    errTitle: 'خطأ',
  },
  fr: {
    title: 'Créer un compte client',
    subtitle: 'Renseignez vos informations et vérifiez votre numéro pour commencer',
    name: 'Nom complet',
    namePlaceholder: 'Ex : Ahmed Benali',
    phone: 'Numéro de téléphone',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    passwordPh: '6 caractères minimum',
    confirmPass: 'Confirmer le mot de passe',
    confirmPassPh: 'Retapez le mot de passe',
    sendOtp: 'Envoyer le code (WhatsApp)',
    otpLabel: 'Entrez le code reçu (WhatsApp)',
    verifyBtn: 'Valider et créer le compte',
    reenterPhone: 'Modifier le numéro de téléphone',
    haveAccount: 'Vous avez un compte ? Connectez-vous',
    errName: 'Veuillez entrer votre nom complet',
    errPhone: 'Numéro invalide, il doit contenir 9 chiffres et commencer par 5, 6 ou 7',
    errEmail: 'Adresse e-mail invalide',
    errPassShort: 'Mot de passe trop court',
    errPassMatch: 'Les mots de passe ne correspondent pas',
    errOtpLen: 'Veuillez entrer le code à 6 chiffres correctement',
    errOtpWrong: 'Code de vérification incorrect',
    errGeneric: "Une erreur est survenue, réessayez",
    sentTitle: 'Envoyé',
    sentMsg: 'Le code de vérification a été envoyé par WhatsApp à votre numéro.',
    errSendTitle: "Erreur d'envoi du code",
    errSendMsg: "Impossible d'envoyer le code, vérifiez le numéro.",
    errTitle: 'Erreur',
  },
  en: {
    title: 'Create customer account',
    subtitle: 'Enter your details and verify your phone number to get started',
    name: 'Full name',
    namePlaceholder: 'e.g. Ahmed Benali',
    phone: 'Phone number',
    email: 'Email address',
    password: 'Password',
    passwordPh: 'At least 6 characters',
    confirmPass: 'Confirm password',
    confirmPassPh: 'Re-enter your password',
    sendOtp: 'Send verification code (WhatsApp)',
    otpLabel: 'Enter the verification code (WhatsApp)',
    verifyBtn: 'Verify code and create account',
    reenterPhone: 'Re-enter phone number',
    haveAccount: 'Already have an account? Log in',
    errName: 'Please enter your full name',
    errPhone: 'Invalid phone number, it must be 9 digits and start with 5, 6, or 7',
    errEmail: 'Invalid email address',
    errPassShort: 'Password is too short',
    errPassMatch: 'Passwords do not match',
    errOtpLen: 'Please enter the 6-digit code correctly',
    errOtpWrong: 'Incorrect verification code',
    errGeneric: 'Something went wrong, try again',
    sentTitle: 'Sent',
    sentMsg: 'The verification code was sent to your phone via WhatsApp.',
    errSendTitle: 'Error sending code',
    errSendMsg: 'Could not send the code, check the number.',
    errTitle: 'Error',
  },
};

export default function SignupCustomer() {
  const router = useRouter();
  const { lang } = useLanguage();
  const T = translations[lang];
  const isRTL = lang === 'ar';

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [otpSent, setOtpSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = () => {
    if (!name.trim()) return T.errName;
    if (!/^[5-7][0-9]{8}$/.test(phone.trim())) return T.errPhone;
    if (!/\S+@\S+\.\S+/.test(email.trim())) return T.errEmail;
    if (password.length < 6) return T.errPassShort;
    if (password !== confirm) return T.errPassMatch;
    return null;
  };

  const handleSendOTP = async () => {
    const err = validate();
    if (err) {
      Alert.alert(T.errTitle, err);
      return;
    }
    setLoading(true);
    try {
      const fullPhoneNumber = '+213' + phone.trim();
      const requestOtp = httpsCallable(functions, 'requestOtp');
      await requestOtp({ phone: fullPhoneNumber });
      setOtpSent(true);
      Alert.alert(T.sentTitle, T.sentMsg);
    } catch (e: any) {
      Alert.alert(T.errSendTitle, e.message || T.errSendMsg);
    }
    setLoading(false);
  };

  const handleVerifyAndSignup = async () => {
    const cleanCode = verificationCode.replace(/[^0-9]/g, '');
    if (!cleanCode || cleanCode.length !== 6) {
      Alert.alert(T.errTitle, T.errOtpLen);
      return;
    }

    setLoading(true);
    try {
      const fullPhoneNumber = '+213' + phone.trim();
      const verifyOtp = httpsCallable(functions, 'verifyOtp');
      await verifyOtp({ phone: fullPhoneNumber, code: cleanCode });

      const res = await createUserWithEmailAndPassword(auth, email.trim(), password);

      await setDoc(doc(db, 'users', res.user.uid), {
        name: name.trim(),
        phone: fullPhoneNumber,
        email: email.trim(),
        role: 'customer',
        photoURL: null,
        createdAt: serverTimestamp(),
      });

      router.replace('/customer');
    } catch (e: any) {
      let msg = e.message || T.errGeneric;
      if (e.code === 'functions/permission-denied') msg = T.errOtpWrong;
      Alert.alert(T.errTitle, msg);
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
        <Text style={s.subtitle}>{T.subtitle}</Text>

        {!otpSent ? (
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
                value={confirm}
                onChangeText={setConfirm}
                placeholder={T.confirmPassPh}
                placeholderTextColor="#bbb"
                secureTextEntry
              />
            </View>

            <TouchableOpacity style={s.submitBtn} onPress={handleSendOTP} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#E8B84B" />
              ) : (
                <Text style={s.submitBtnText}>{T.sendOtp}</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={s.inputWrap}>
              <Text style={[s.label, { textAlign: isRTL ? 'right' : 'left' }]}>{T.otpLabel}</Text>
              <TextInput
                style={[s.input, { textAlign: 'center', fontSize: 20, letterSpacing: 4 }]}
                value={verificationCode}
                onChangeText={setVerificationCode}
                placeholder="123456"
                placeholderTextColor="#bbb"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>

            <TouchableOpacity style={s.submitBtn} onPress={handleVerifyAndSignup} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#E8B84B" />
              ) : (
                <Text style={s.submitBtnText}>{T.verifyBtn}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setOtpSent(false)}>
              <Text style={s.loginLink}>{T.reenterPhone}</Text>
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
  scrollContent: { padding: 24, paddingTop: 60, paddingBottom: 220 },
  emoji: { fontSize: 48, textAlign: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '900', color: '#1F2A40', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#1F2A40', textAlign: 'center', marginBottom: 24, opacity: 0.8 },
  inputWrap: { marginBottom: 16 },
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
  loginLink: { fontSize: 13, color: '#1F2A40', textAlign: 'center', marginTop: 16, fontWeight: '600' },
});

