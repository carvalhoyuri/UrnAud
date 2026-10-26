import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [query])
  return m
}

export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch { /* armazenamento indisponível */ }
  }
  return [dark, toggle]
}

export function initTheme() {
  let t: string | null = null
  try { t = localStorage.getItem('theme') } catch { /* ignore */ }
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
}

export function useLocalStorage<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : init
    } catch { return init }
  })
  const set = (x: T) => {
    setV(x)
    try { localStorage.setItem(key, JSON.stringify(x)) } catch { /* ignore */ }
  }
  return [v, set]
}
