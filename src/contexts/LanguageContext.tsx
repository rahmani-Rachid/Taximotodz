import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type Lang = 'ar' | 'fr' | 'en';

interface LanguageContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  ready: boolean; // true بعد تحميل اللغة المحفوظة من الذاكرة
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'ar',
  setLang: () => {},
  ready: false,
});

const STORAGE_KEY = 'app_language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');
  const [ready, setReady] = useState(false);

  // عند فتح التطبيق: نقرأ اللغة المحفوظة سابقاً (إن وجدت)
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'ar' || saved === 'fr' || saved === 'en') {
          setLangState(saved);
        }
      })
      .finally(() => setReady(true));
  }, []);

  // كل تغيير للغة يُحفظ فوراً + يُطبَّق على كل الصفحات المشتركة في هذا الـ Context
  const setLang = (l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, ready }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

