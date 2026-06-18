import { createContext, useContext, useState, useEffect } from 'react'
import { getMe } from '../api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { setAuthReady(true); return }
    getMe().then(setUser).catch(() => localStorage.removeItem('token')).finally(() => setAuthReady(true))
  }, [])

  function login(token, userData) {
    localStorage.setItem('token', token)
    setUser(userData)
  }

  function logout() {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, authReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
