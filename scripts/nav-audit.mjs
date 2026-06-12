#!/usr/bin/env node
// scripts/nav-audit.mjs
// [NAV-AUDIT] Orphan-page & broken-link control for BoekBrug.
//
// Run from the repo root:   node scripts/nav-audit.mjs
// No dependencies. Read-only. Safe to run anytime.
//
// What it does:
//   1. Scans src/app for page.tsx / route.ts → derives every route (handles
//      route groups "(x)", dynamic "[id]", catch-all "[...x]", private "_folder").
//   2. Scans all src/**/*.{ts,tsx,js,jsx} for navigation targets:
//      href="/...",  router.push/replace/prefetch('/...'),  redirect('/...'),
//      plus template-literal prefixes  router.push(`/x/${id}`).
//   3. Matches links → most specific route (static beats dynamic, like Next.js).
//   4. Reports:
//        - ORPHAN page candidates  (a page with no inbound link)
//        - BROKEN link candidates   (a link to a route that doesn't exist)
//
// Tune ALLOWLIST below for pages reached without an in-code link
// (home pages, auth redirects, middleware-driven routes).

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const APP_DIR = 'src/app'
const SRC_DIR = 'src'

// Reachable without an explicit in-code link (entry points / redirects / middleware).
const ALLOWLIST = new Set([
  '/',
  '/dashboard',
  '/dashboard/accountant',
  '/login',
  '/register',
  '/onboarding',
  '/auth/callback',
])

const PAGE_FILE = /^(page|route)\.(tsx|ts|jsx|js)$/
const NON_ROUTE = /^(layout|loading|error|not-found|template|default|global-error)\.(tsx|ts|jsx|js)$/

function walk(dir, acc = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue
      walk(p, acc)
    } else {
      acc.push(p)
    }
  }
  return acc
}

// Derive a Next.js route from an app-dir page/route file path.
function fileToRoute(file) {
  const relParts = relative(APP_DIR, file).split(sep)
  const fname = relParts.pop()
  const isApi = fname.startsWith('route.')
  const segs = []
  for (const s of relParts) {
    if (/^\(.*\)$/.test(s)) continue   // route group → invisible in URL
    if (/^@/.test(s)) continue         // parallel route slot
    if (/^_/.test(s)) return null      // private folder → not routable
    segs.push(s)
  }
  const route = ('/' + segs.join('/')).replace(/\/+$/, '') || '/'
  return { route, isApi, file: relative('.', file) }
}

// Regex matcher for a route pattern with [id], [...slug], [[...opt]].
function routeToRegex(route) {
  const parts = route.split('/').filter(Boolean).map(seg => {
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) return '(?:[^/]+)?'   // optional catch-all (simplified)
    if (/^\[\.\.\..+\]$/.test(seg)) return '.+'               // catch-all
    if (/^\[.+\]$/.test(seg)) return '[^/]+'                  // dynamic
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')         // literal
  })
  return new RegExp('^/' + parts.join('/') + '/?$')
}

// Specificity: more static segments first, fewer dynamic first.
function specificity(route) {
  const segs = route.split('/').filter(Boolean)
  const dyn = segs.filter(s => s.startsWith('[')).length
  return { staticCount: segs.length - dyn, dyn }
}

// Normalize a route or template body to segment-wildcard form, so a template link
// like /dashboard/clients/${id}/kwartaal and the route /dashboard/clients/[id]/kwartaal
// both reduce to /dashboard/clients/*/kwartaal and compare equal.
function normSeg(path) {
  return ('/' + path.split('?')[0].split('#')[0]
    .split('/')
    .filter(Boolean)
    .map(s => (s.includes('${') || /^\[.*\]$/.test(s)) ? '*' : s)
    .join('/')) || '/'
}

function extractLinks(text) {
  const exact = new Set()
  const prefix = new Set()

  const exactRes = [
    /href\s*=\s*["']\s*(\/[^"'?#]*)/g,
    /(?:router\.(?:push|replace|prefetch)|redirect|permanentRedirect)\(\s*["']\s*(\/[^"'?#]*)/g,
  ]
  for (const re of exactRes) {
    let m
    while ((m = re.exec(text))) {
      const l = m[1].replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'
      exact.add(l)
    }
  }

  // Template literals — capture the FULL body between backticks, e.g.
  //   router.push(`/dashboard/clients/${id}/kwartaal`)  -> /dashboard/clients/${id}/kwartaal
  const tplRes = [
    /href\s*=\s*\{?\s*`(\/[^`]*)`/g,
    /(?:router\.(?:push|replace|prefetch)|redirect|permanentRedirect)\(\s*`(\/[^`]*)`/g,
  ]
  for (const re of tplRes) {
    let m
    while ((m = re.exec(text))) {
      prefix.add(m[1].replace(/[?#].*$/, ''))
    }
  }

  return { exact, templates: prefix }
}

function ignorable(link) {
  return link.startsWith('/api')
    || link.startsWith('/_next')
    || /\.[a-z0-9]+$/i.test(link)   // asset-like (.png, .css, …)
}

// ── main ──
const allFiles = walk(SRC_DIR)
const codeFiles = allFiles.filter(f => /\.(tsx|ts|jsx|js)$/.test(f))

// routes
const routeMap = new Map()
for (const f of allFiles) {
  const base = f.split(sep).pop()
  if (!PAGE_FILE.test(base) || NON_ROUTE.test(base)) continue
  const r = fileToRoute(f)
  if (!r) continue
  const key = r.route + (r.isApi ? '#api' : '')
  if (!routeMap.has(key)) routeMap.set(key, r)
}
const allRoutes = [...routeMap.values()]
const pageRoutes = allRoutes.filter(r => !r.isApi)

// links
const exactLinks = new Set()
const templateLinks = new Set()
for (const f of codeFiles) {
  let text
  try { text = readFileSync(f, 'utf8') } catch { continue }
  const { exact, templates } = extractLinks(text)
  for (const l of exact) exactLinks.add(l)
  for (const p of templates) templateLinks.add(p)
}

// match
const ordered = [...pageRoutes].sort((a, b) => {
  const sa = specificity(a.route), sb = specificity(b.route)
  return sb.staticCount - sa.staticCount || sa.dyn - sb.dyn
})
const reachable = new Set()
const broken = []

for (const l of exactLinks) {
  if (ignorable(l)) continue
  const hit = ordered.find(r => routeToRegex(r.route).test(l))
  if (hit) reachable.add(hit.route)
  else broken.push(l)
}

// template links → normalized-segment equality (handles deep dynamic paths)
const normToRoutes = new Map()   // normalized form → [routes]
for (const r of pageRoutes) {
  const n = normSeg(r.route)
  if (!normToRoutes.has(n)) normToRoutes.set(n, [])
  normToRoutes.get(n).push(r.route)
}
for (const t of templateLinks) {
  if (ignorable(t)) continue
  const hit = normToRoutes.get(normSeg(t))
  if (hit) for (const rt of hit) reachable.add(rt)
}

const orphans = pageRoutes
  .filter(r => !reachable.has(r.route))
  .filter(r => !ALLOWLIST.has(r.route))
  .sort((a, b) => a.route.localeCompare(b.route))

const uniqBroken = [...new Set(broken)]
  .filter(l => !ALLOWLIST.has(l))
  .sort()

// ── report ──
console.log('\n=== BoekBrug Navigation Audit ===\n')
console.log(`Pages found:        ${pageRoutes.length}`)
console.log(`API routes found:   ${allRoutes.length - pageRoutes.length}`)
console.log(`Exact link targets: ${exactLinks.size}`)
console.log(`Template targets:   ${templateLinks.size}\n`)

console.log('--- ORPHAN PAGE CANDIDATES (no inbound link found) ---')
if (orphans.length === 0) console.log('  none')
else for (const r of orphans) console.log(`  [orphan] ${r.route}\n            ${r.file}`)

console.log('\n--- BROKEN LINK CANDIDATES (point to a non-existent page) ---')
if (uniqBroken.length === 0) console.log('  none')
else for (const l of uniqBroken) console.log(`  [broken] ${l}`)

console.log('\nNote: these are CANDIDATES, not certainties. Pages reached only via')
console.log('middleware, redirects, or fully dynamic hrefs can appear as false')
console.log('positives — add them to ALLOWLIST at the top of this file and re-run.\n')
