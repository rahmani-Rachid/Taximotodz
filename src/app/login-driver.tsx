import { useRouter } from 'expo-router';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useLanguage, type Lang } from '../contexts/LanguageContext';
import { auth, db } from '../utils/firebase';

const T: Record<Lang, Record<string, string>> = {
  ar: {
    title:            'دخول السائق 🏍️',
    email:            'البريد الإلكتروني',
    password:         'كلمة المرور',
    passwordPh:       'أدخل كلمة المرور',
    login:            'دخول ✓',
    forgotPassword:   'نسيت كلمة المرور؟',
    noAccount:        'ليس لديك حساب؟ سجل كسائق',
    resetTitle:       'نسيت كلمة المرور؟',
    resetSub:         'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين',
    sendReset:        'إرسال رابط الإعادة 📧',
    backToLogin:      '← رجوع لتسجيل الدخول',
    errTitle:         'خطأ',
    errEmail:         'أدخل بريدك الإلكتروني',
    errPass:          'كلمة المرور 6 أحرف على الأقل',
    errNoDriverAcc:   'لا يوجد حساب سائق بهذا البريد',
    pendingTitle:     '⏳ قيد المراجعة',
    pendingMsg:       'طلبك لازال قيد المراجعة، سيصلك إشعار عند القبول',
    rejectedTitle:    '❌ مرفوض',
    rejectedMsg:      'تم رفض طلبك، تواصل مع الدعم',
    errWrongCred:     'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    errNotFound:      'لا يوجد حساب بهذا البريد الإلكتروني',
    errValidEmail:    'أدخل بريدك الإلكتروني الصحيح',
    resetSentTitle:   '✅ تم الإرسال',
    resetSentMsg:     (email: string) => `أُرسل رابط إعادة تعيين كلمة المرور إلى:\n${email}\n\nتحقق من بريدك الإلكتروني`,
  },
  fr: {
    title:            'Connexion chauffeur 🏍️',
    email:            'Email',
    password:         'Mot de passe',
    passwordPh:       'Entrez votre mot de passe',
    login:            'Connexion ✓',
    forgotPassword:   'Mot de passe oublié ?',
    noAccount:        "Vous n'avez pas de compte ? Inscrivez-vous comme chauffeur",
    resetTitle:       'Mot de passe oublié ?',
    resetSub:         'Entrez votre email et nous vous enverrons un lien de réinitialisation',
    sendReset:        'Envoyer le lien 📧',
    backToLogin:      '← Retour à la connexion',
    errTitle:         'Erreur',
    errEmail:         'Entrez votre email',
    errPass:          'Le mot de passe doit avoir 6 caractères minimum',
    errNoDriverAcc:   'Aucun compte chauffeur avec cet email',
    pendingTitle:     '⏳ En cours de vérification',
    pendingMsg:       'Votre demande est en cours de vérification, vous serez notifié une fois acceptée',
    rejectedTitle:    '❌ Refusé',
    rejectedMsg:      'Votre demande a été refusée, contactez le support',
    errWrongCred:     'Email ou mot de passe incorrect',
    errNotFound:      'Aucun compte avec cet email',
    errValidEmail:    'Entrez une adresse email valide',
    resetSentTitle:   '✅ Envoyé',
    resetSentMsg:     (email: string) => `Le lien de réinitialisation a été envoyé à :\n${email}\n\nVérifiez votre email`,
  },
  en: {
    title:            'Driver Login 🏍️',
    email:            'Email',
    password:         'Password',
    passwordPh:       'Enter your password',
    login:            'Login ✓',
    forgotPassword:   'Forgot password?',
    noAccount:        "Don't have an account? Sign up as a driver",
    resetTitle:       'Forgot password?',
    resetSub:         "Enter your email and we'll send you a reset link",
    sendReset:        'Send reset link 📧',
    backToLogin:      '← Back to login',
    errTitle:         'Error',
    errEmail:         'Enter your email',
    errPass:          'Password must be at least 6 characters',
    errNoDriverAcc:   'No driver account found with this email',
    pendingTitle:     '⏳ Under review',
    pendingMsg:       'Your application is still under review, you will be notified once approved',
    rejectedTitle:    '❌ Rejected',
    rejectedMsg:      'Your application was rejected, contact support',
    errWrongCred:     'Incorrect email or password',
    errNotFound:      'No account found with this email',
    errValidEmail:    'Enter a valid email address',
    resetSentTitle:   '✅ Sent',
    resetSentMsg:     (email: string) => `A password reset link was sent to:\n${email}\n\nCheck your email`,
  },
};

export default function LoginDriver() {
  const router = useRouter();
  const { lang } = useLanguage();
  const t = T[lang];
  const isRTL = lang === 'ar';

  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  // ── تسجيل الدخول ──
  const handleLogin = async () => {
    if (!email.includes('@')) { Alert.alert(t.errTitle, t.errEmail); return; }
    if (password.length < 6)  { Alert.alert(t.errTitle, t.errPass); return; }

    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, 'drivers', cred.user.uid));
      const data = snap.data();

      if (!data) {
        Alert.alert(`❌ ${t.errTitle}`, t.errNoDriverAcc);
        await auth.signOut();
        setLoading(false);
        return;
      }

      if (data.kyc_status === 'pending') {
        Alert.alert(t.pendingTitle, t.pendingMsg);
        await auth.signOut();
        setLoading(false);
        return;
      }

      if (data.kyc_status === 'rejected') {
        Alert.alert(t.rejectedTitle, t.rejectedMsg);
        await auth.signOut();
        setLoading(false);
        return;
      }

      router.replace('/app-driver');

    } catch (e: any) {
      if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
        Alert.alert(`❌ ${t.errTitle}`, t.errWrongCred);
      } else if (e.code === 'auth/user-not-found') {
        Alert.alert(`❌ ${t.errTitle}`, t.errNotFound);
      } else {
        Alert.alert(t.errTitle, e.message);
      }
    }
    setLoading(false);
  };

  // ── إعادة تعيين كلمة المرور ──
  const handleReset = async () => {
    if (!resetEmail.includes('@')) {
      Alert.alert(t.errTitle, t.errValidEmail);
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      Alert.alert(t.resetSentTitle, t.resetSentMsg(resetEmail));
      setShowReset(false);
      setResetEmail('');
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        Alert.alert(`❌ ${t.errTitle}`, t.errNotFound);
      } else {
        Alert.alert(t.errTitle, e.message);
      }
    }
    setLoading(false);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      <View style={[s.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>{isRTL ? '→' : '←'}</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.title}</Text>
      </View>

      {!showReset ? (
        <>
          <View style={s.fieldWrap}>
            <Text style={[s.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.email}</Text>
            <TextInput
              style={s.fieldInput}
              value={email}
              onChangeText={setEmail}
              placeholder="example@gmail.com"
              placeholderTextColor="#bbb"
              keyboardType="email-address"
              textAlign={isRTL ? 'right' : 'left'}
              autoCapitalize="none"
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={[s.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.password}</Text>
            <TextInput
              style={s.fieldInput}
              value={password}
              onChangeText={setPassword}
              placeholder={t.passwordPh}
              placeholderTextColor="#bbb"
              secureTextEntry
              textAlign={isRTL ? 'right' : 'left'}
            />
          </View>

          {loading
            ? <ActivityIndicator color="#E8B84B" size="large" style={{ marginTop:20 }} />
            : (
              <TouchableOpacity style={s.btn} onPress={handleLogin}>
                <Text style={s.btnText}>{t.login}</Text>
              </TouchableOpacity>
            )
          }

          <TouchableOpacity style={s.forgotBtn} onPress={() => { setResetEmail(email); setShowReset(true); }}>
            <Text style={s.forgotText}>{t.forgotPassword}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.linkBtn} onPress={() => router.push('/register-driver')}>
            <Text style={s.linkText}>{t.noAccount}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={s.resetBox}>
          <Text style={s.resetIcon}>🔑</Text>
          <Text style={s.resetTitle}>{t.resetTitle}</Text>
          <Text style={s.resetSub}>{t.resetSub}</Text>

          <View style={s.fieldWrap}>
            <Text style={[s.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t.email}</Text>
            <TextInput
              style={s.fieldInput}
              value={resetEmail}
              onChangeText={setResetEmail}
              placeholder="example@gmail.com"
              placeholderTextColor="#bbb"
              keyboardType="email-address"
              textAlign={isRTL ? 'right' : 'left'}
              autoCapitalize="none"
            />
          </View>

          {loading
            ? <ActivityIndicator color="#E8B84B" size="large" style={{ marginTop:20 }} />
            : (
              <TouchableOpacity style={s.btn} onPress={handleReset}>
                <Text style={s.btnText}>{t.sendReset}</Text>
              </TouchableOpacity>
            )
          }

          <TouchableOpacity style={s.linkBtn} onPress={() => setShowReset(false)}>
            <Text style={s.linkText}>{t.backToLogin}</Text>
          </TouchableOpacity>
        </View>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:'#fff' },
  content:     { padding:24, paddingBottom:60 },
  header:      { alignItems:'center', marginBottom:36, gap:12 },
  backBtn:     { width:40, height:40, borderRadius:20, backgroundColor:'#f0f0f0', alignItems:'center', justifyContent:'center' },
  backBtnText: { fontSize:20, color:'#333' },
  title:       { fontSize:22, fontWeight:'bold', color:'#222' },
  fieldWrap:   { marginBottom:16 },
  fieldLabel:  { fontSize:14, fontWeight:'600', color:'#555', marginBottom:6 },
  fieldInput:  { backgroundColor:'#f7f7f7', borderRadius:12, padding:14, fontSize:15, color:'#222', borderWidth:1, borderColor:'#eee' },
  btn:         { backgroundColor:'#E8B84B', padding:15, borderRadius:14, alignItems:'center', marginTop:8, elevation:3 },
  btnText:     { fontSize:16, fontWeight:'bold', color:'#1F2A40' },
  forgotBtn:   { marginTop:16, alignItems:'center' },
  forgotText:  { color:'#888', fontSize:14, textDecorationLine:'underline' },
  linkBtn:     { marginTop:12, alignItems:'center' },
  linkText:    { color:'#E8B84B', fontSize:14, textDecorationLine:'underline', textAlign:'center' },
  resetBox:    { alignItems:'center', paddingTop:20 },
  resetIcon:   { fontSize:64, marginBottom:16 },
  resetTitle:  { fontSize:22, fontWeight:'bold', color:'#222', marginBottom:8 },
  resetSub:    { fontSize:14, color:'#888', textAlign:'center', marginBottom:24, lineHeight:22, paddingHorizontal:20 },
});

