import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'

import { auth } from '../lib/firebase'
import { getUserProfile } from '../lib/firestore'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!auth) {
      setFirebaseUser(null)
      setProfile(null)
      setLoading(false)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user)

      if (user) {
        const userProfile = await getUserProfile(user.uid)
        setProfile(userProfile)
      } else {
        setProfile(null)
      }

      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    if (!auth) {
      throw new Error('Firebase Authentication is not configured. Add the Firebase config values in your .env file.')
    }

    const result = await signInWithEmailAndPassword(auth, email, password)
    return result
  }

  const logout = async () => {
    await firebaseSignOut(auth)
    setProfile(null)
  }

  const value = useMemo(
    () => ({
      user: firebaseUser,
      profile,
      loading,
      signIn,
      logout,
      isAuthenticated: Boolean(firebaseUser),
      isOwner: profile?.role === 'owner',
      hasPermission: (permission) => Boolean(profile?.permissions?.includes(permission) || profile?.role === 'owner'),
    }),
    [firebaseUser, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.')
  }

  return context
}
