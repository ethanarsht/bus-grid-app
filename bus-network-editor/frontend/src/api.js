const BASE = '/api'

export async function getBaseline() {
  const res = await fetch(`${BASE}/network/baseline`)
  if (!res.ok) throw new Error('Failed to load baseline network')
  return res.json()
}

export async function createScenario(name, description) {
  const res = await fetch(`${BASE}/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
  if (!res.ok) throw new Error('Failed to create scenario')
  return res.json()
}

export async function getScenario(scenarioId) {
  const res = await fetch(`${BASE}/scenarios/${scenarioId}`)
  if (!res.ok) throw new Error('Failed to load scenario')
  return res.json()
}

export async function addEditsBatch(scenarioId, edits) {
  const res = await fetch(`${BASE}/scenarios/${scenarioId}/edits/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edits }),
  })
  if (!res.ok) throw new Error('Failed to apply bulk edits')
  return res.json()
}

export async function addEdit(scenarioId, edit) {
  const res = await fetch(`${BASE}/scenarios/${scenarioId}/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edit),
  })
  if (!res.ok) throw new Error('Failed to add edit')
  return res.json()
}

export async function undoLastEdit(scenarioId) {
  const res = await fetch(`${BASE}/scenarios/${scenarioId}/edits/last`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to undo edit')
  return res.json()
}

export async function getProjection(scenarioId) {
  const res = await fetch(`${BASE}/scenarios/${scenarioId}/projection`)
  if (!res.ok) throw new Error('Failed to load projection')
  return res.json()
}

export function exportUrl(scenarioId) {
  return `${BASE}/scenarios/${scenarioId}/export`
}
