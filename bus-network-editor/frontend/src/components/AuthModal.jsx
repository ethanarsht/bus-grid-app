import { useState } from 'react'
import { register, loginApi } from '../api.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import './AuthModal.css'

export default function AuthModal({ onClose }) {
  const { login } = useAuth()
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = tab === 'login'
        ? await loginApi(email, password)
        : await register(email, username, password)
      login(data.token, data.user)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal auth-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{tab === 'login' ? 'Log in' : 'Create account'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs">
          <button className={`modal-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError(null) }}>Log in</button>
          <button className={`modal-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(null) }}>Sign up</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>Email
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </label>
          {tab === 'register' && (
            <label>Username
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Optional" />
            </label>
          )}
          <label>Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? '…' : tab === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
