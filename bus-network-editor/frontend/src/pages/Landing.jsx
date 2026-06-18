import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCities, listScenarios, listPublishedScenarios, createScenario } from '../api.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import AuthModal from '../components/AuthModal.jsx'
import './Landing.css'

function CityCard({ city, onSelect }) {
  return (
    <button className="city-card" onClick={() => onSelect(city)}>
      <div className="city-card-name">{city.name}</div>
      <div className="city-card-desc">{city.description}</div>
      <div className="city-card-stats">
        <span>{city.stop_count.toLocaleString()} stops</span>
        <span>·</span>
        <span>{city.route_count} routes</span>
      </div>
    </button>
  )
}

function ScenarioRow({ scenario, onClick }) {
  const date = scenario.created_at
    ? new Date(scenario.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''
  return (
    <button className="scenario-row" onClick={onClick}>
      <div className="scenario-row-left">
        <div className="scenario-row-name">{scenario.name || 'Untitled'}</div>
        <div className="scenario-row-meta">
          {scenario.author && <span>{scenario.author} · </span>}
          {scenario.city_id} · {date}
          {scenario.is_published && <span className="published-badge">Published</span>}
        </div>
      </div>
      <div className="scenario-row-arrow">→</div>
    </button>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const { user, authReady, logout } = useAuth()
  const [myScenarios, setMyScenarios] = useState([])
  const [publishedScenarios, setPublishedScenarios] = useState([])
  const [cities, setCities] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [activeTab, setActiveTab] = useState('official')
  const [mapsTab, setMapsTab] = useState('mine')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!authReady) return
    getCities().then(setCities).catch(e => setError(e.message))
    listPublishedScenarios().then(setPublishedScenarios).catch(() => {})
    if (user) listScenarios().then(setMyScenarios).catch(() => {})
  }, [authReady, user])

  async function handleSelectCity(city) {
    setCreating(true)
    try {
      const { scenario_id } = await createScenario(`New ${city.name} Map`, city.city_id)
      navigate(`/editor?scenario=${scenario_id}&city=${city.city_id}`)
    } catch (e) {
      setError(e.message)
      setCreating(false)
    }
  }

  const officialCities = cities.filter(c => c.type === 'official')
  const userCities = cities.filter(c => c.type === 'user')

  if (!authReady) return null

  return (
    <div className="landing">
      <div className="landing-header">
        <div className="landing-header-top">
          <div>
            <div className="landing-title">Ethan's Retransiting App</div>
            <div className="landing-subtitle">Edit and analyze transit networks</div>
          </div>
          <div className="landing-auth">
            {user ? (
              <>
                <span className="landing-username">{user.username}</span>
                <button className="landing-auth-btn" onClick={logout}>Log out</button>
              </>
            ) : (
              <button className="landing-auth-btn primary" onClick={() => setShowAuthModal(true)}>Log in / Sign up</button>
            )}
          </div>
        </div>
      </div>

      <div className="landing-body">
        <div className="landing-new">
          <button className="landing-new-btn" onClick={() => setShowModal(true)}>
            <span className="landing-new-icon">+</span>
            <span>New Map</span>
          </button>
        </div>

        <div className="landing-maps">
          <div className="landing-maps-tabs">
            <button
              className={`landing-maps-tab ${mapsTab === 'mine' ? 'active' : ''}`}
              onClick={() => setMapsTab('mine')}
            >My Maps</button>
            <button
              className={`landing-maps-tab ${mapsTab === 'published' ? 'active' : ''}`}
              onClick={() => setMapsTab('published')}
            >Other Maps</button>
          </div>

          {mapsTab === 'mine' ? (
            !user ? (
              <div className="landing-login-prompt">
                <span>Log in to see your maps.</span>
                <button className="landing-auth-btn primary" onClick={() => setShowAuthModal(true)}>Log in</button>
              </div>
            ) : myScenarios.length === 0 ? (
              <div className="landing-empty">No maps yet. Create one to get started.</div>
            ) : (
              <div className="landing-scenario-list">
                {myScenarios.map(s => (
                  <ScenarioRow
                    key={s.scenario_id}
                    scenario={s}
                    onClick={() => navigate(`/editor?scenario=${s.scenario_id}&city=${s.city_id || 'chicago_cta'}`)}
                  />
                ))}
              </div>
            )
          ) : (() => {
            const otherMaps = publishedScenarios.filter(s =>
              !myScenarios.some(m => m.scenario_id === s.scenario_id)
            )
            return otherMaps.length === 0 ? (
              <div className="landing-empty">No published maps from other users yet.</div>
            ) : (
              <div className="landing-scenario-list">
                {otherMaps.map(s => (
                  <ScenarioRow
                    key={s.scenario_id}
                    scenario={s}
                    onClick={() => navigate(`/editor?scenario=${s.scenario_id}&city=${s.city_id || 'chicago_cta'}`)}
                  />
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {error && (
        <div className="landing-error">
          {error} <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => !creating && setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Choose a network</div>
              <button className="modal-close" onClick={() => setShowModal(false)} disabled={creating}>✕</button>
            </div>

            <div className="modal-tabs">
              <button className={`modal-tab ${activeTab === 'official' ? 'active' : ''}`} onClick={() => setActiveTab('official')}>Official GTFS</button>
              <button className={`modal-tab ${activeTab === 'user' ? 'active' : ''}`} onClick={() => setActiveTab('user')}>Community Maps</button>
            </div>

            <div className="modal-body">
              {!user && (
                <div className="modal-guest-note">
                  You're not signed in — your map won't appear in My Maps.{' '}
                  <button className="modal-guest-signin" onClick={() => { setShowModal(false); setShowAuthModal(true) }}>Sign in</button>
                </div>
              )}
              {creating ? (
                <div className="modal-loading">Creating map…</div>
              ) : activeTab === 'official' ? (
                officialCities.length > 0 ? (
                  <div className="city-grid">
                    {officialCities.map(c => (
                      <CityCard key={c.city_id} city={c} onSelect={handleSelectCity} />
                    ))}
                  </div>
                ) : (
                  <div className="modal-empty">No official networks available.</div>
                )
              ) : (() => {
                const communityMaps = publishedScenarios.filter(s =>
                  !myScenarios.some(m => m.scenario_id === s.scenario_id)
                )
                return communityMaps.length === 0 ? (
                  <div className="modal-empty">No community maps published yet.</div>
                ) : (
                  <div className="city-grid">
                    {communityMaps.map(s => (
                      <button key={s.scenario_id} className="city-card" onClick={() => navigate(`/editor?scenario=${s.scenario_id}&city=${s.city_id || 'chicago_cta'}`)}>
                        <div className="city-card-name">{s.name}</div>
                        <div className="city-card-desc">by {s.author || 'Anonymous'} · {s.city_id}</div>
                      </button>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}
    </div>
  )
}
