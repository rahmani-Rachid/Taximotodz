import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, query, Unsubscribe, where } from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../utils/firebase';

type NotifCtx = {
  unreadCount: number;
};

const NotificationContext = createContext<NotifCtx>({ unreadCount: 0 });
export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let unsubNotif: Unsubscribe | null = null;
    let authUnsub = onAuthStateChanged(auth, (user: User | null) => {
      // clean previous subscription
      if (unsubNotif) {
        unsubNotif();
        unsubNotif = null;
      }

      if (!user) {
        setUnreadCount(0);
        return;
      }

      // استمع لمستندات في root collection 'notifications' التي تحتوي userId == uid و read == false
      try {
        const q = query(
          collection(db, 'notifications'),
          where('userId', '==', user.uid),
          where('read', '==', false)
        );
        unsubNotif = onSnapshot(q, (snap) => {
          setUnreadCount(snap.size);
        }, (err) => {
          console.warn('notifications listener error', err);
          setUnreadCount(0);
        });
      } catch (e) {
        console.warn('notifications subscribe failed', e);
      }
    });

    return () => {
      if (unsubNotif) unsubNotif();
      authUnsub();
    };
  }, []);

  return (
    <NotificationContext.Provider value={{ unreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
};

