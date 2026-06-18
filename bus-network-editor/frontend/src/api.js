const BASE = '/api'

function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail ?? detail } catch {}
    throw new Error(detail)
  }
  return res.json()
}

// Auth
export async function register(email, username, password) {
  return apiFetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password }),
  })
}

export async function loginApi(email, password) {
  return apiFetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export async function getMe() {
  return apiFetch(`${BASE}/auth/me`)
}

// Cities
export async function getCities() {
  return apiFetch(`${BASE}/cities`)
}

// Scenarios
export async function listScenarios() {
  return apiFetch(`${BASE}/scenarios`)
}

export async function listPublishedScenarios() {
  return apiFetch(`${BASE}/scenarios/published`)
}

export async function getBaseline(cityId = 'chicago_cta') {
  return apiFetch(`${BASE}/network/baseline?city_id=${encodeURIComponent(cityId)}`)
}

export async function createScenario(name, cityId, description) {
  return apiFetch(`${BASE}/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, city_id: cityId, description }),
  })
}

export async function updateScenario(scenarioId, patch) {
  return apiFetch(`${BASE}/scenarios/${scenarioId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export async function publishScenario(scenarioId) {
  return apiFetch(`${BASE}/scenarios/${scenarioId}/publish`, { method: 'POST' })
}

export async function addEditsBatch(scenarioId, edits) {
  return apiFetch(`${BASE}/scenarios/${scenarioId}/edits/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edits }),
  })
}

export async function addEdit(scenarioId, edit) {
  return apiFetch(`${BASE}/scenarios/${scenarioId}/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edit),
  })
}

export async function undoLastEdit(scenarioId) {
  return apiFetch(`${BASE}/scenarios/${scenarioId}/edits/last`, { method: 'DELETE' })
}

export async function getProjection(scenarioId) {
  return apiFetch(`${BASE}/scenarios/${scenarioId}/projection`)
}

export function exportUrl(scenarioId) {
  return `${BASE}/scenarios/${scenarioId}/export`
}

export async function getCensusData(cityId) {
  return apiFetch(`${BASE}/census/${encodeURIComponent(cityId)}`)
}
