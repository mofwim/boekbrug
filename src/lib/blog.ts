// src/lib/blog.ts
// [BLOG] Single source of truth for the Markdown-file blog. Reads .mdx/.md
// files from content/blog/{nl,en}/, parses YAML frontmatter with gray-matter,
// and exposes typed helpers for the index, the article pages, generateMetadata,
// generateStaticParams and the sitemap. No database — files only (v1).
//
// Server-only: uses node:fs and runs at build time (SSG). Never import this
// into a client component.

import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import readingTime from 'reading-time'

export type Locale = 'nl' | 'en' | 'ar' | 'tr'
export const LOCALES: Locale[] = ['nl', 'en', 'ar', 'tr']
export const DEFAULT_LOCALE: Locale = 'nl'

// Per-locale presentation + SEO metadata. `dir` drives RTL for Arabic; `intl`
// is the BCP-47 tag for Intl date formatting (ar forces Latin digits so money
// and dates read consistently); `label` is the language's own name for the
// language switch; `hreflang`/`ogLocale` feed SEO.
export interface LocaleMeta {
  dir: 'ltr' | 'rtl'
  label: string
  hreflang: string
  ogLocale: string
  intl: string
}
export const LOCALE_META: Record<Locale, LocaleMeta> = {
  nl: { dir: 'ltr', label: 'Nederlands', hreflang: 'nl-NL', ogLocale: 'nl_NL', intl: 'nl-NL' },
  en: { dir: 'ltr', label: 'English', hreflang: 'en-GB', ogLocale: 'en_GB', intl: 'en-GB' },
  ar: { dir: 'rtl', label: 'العربية', hreflang: 'ar', ogLocale: 'ar_AR', intl: 'ar-u-nu-latn' },
  tr: { dir: 'ltr', label: 'Türkçe', hreflang: 'tr-TR', ogLocale: 'tr_TR', intl: 'tr-TR' },
}

// Frontmatter contract — mirrors the schema in the build spec. `alternateSlug`
// is the slug of the SAME article in the other language; it drives the hreflang
// links and the language-switch. `draft: true` posts are never listed or built.
export interface PostFrontmatter {
  title: string
  description: string
  slug: string
  locale: Locale
  publishedAt: string // ISO date, e.g. "2026-07-15"
  updatedAt?: string
  author: string
  keywords: string[]
  relatedTool: string // path to the funnel tool, e.g. "/netto-inkomen-zzp"
  relatedToolLabel: string // button label for the tool CTA
  coverImage?: string
  alternateSlug?: string // slug of this article in the other locale (NL↔EN legacy pairing)
  // Translation group key: the SAME value across every language version of one
  // article (canonically the NL slug). Lets alternates/hreflang work across all
  // 4 locales. Optional — falls back to slug (NL) / alternateSlug (others).
  transKey?: string
  // Topic-cluster link: a supporting article points UP to its pillar/guide.
  // ArticleLayout renders "part of the guide: [pillarTitle]" from these two.
  pillarSlug?: string // slug (same locale) of the pillar this article belongs to
  pillarTitle?: string // display title of that pillar
  draft?: boolean
}

export interface Post {
  frontmatter: PostFrontmatter
  content: string // the Markdown body (frontmatter stripped)
  readingMinutes: number // rounded up, from word count
}

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')

function localeDir(locale: Locale): string {
  return path.join(BLOG_DIR, locale)
}

// URL path for an article, respecting the "Dutch has no locale prefix" rule.
export function articlePath(locale: Locale, slug: string): string {
  return locale === DEFAULT_LOCALE ? `/blog/${slug}` : `/${locale}/blog/${slug}`
}

// URL path for a blog index.
export function indexPath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '/blog' : `/${locale}/blog`
}

// Raw slugs present on disk for a locale (drafts included) — used only as the
// discovery step; callers filter drafts via the loaders below.
function rawSlugs(locale: Locale): string[] {
  const dir = localeDir(locale)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'))
    .map((f) => f.replace(/\.mdx?$/, ''))
}

// Read + parse a single file into a Post. Returns null if the file is missing.
// Draft filtering is the caller's job (generateStaticParams needs drafts out;
// nothing else should surface them).
function readPost(locale: Locale, slug: string): Post | null {
  const dir = localeDir(locale)
  const candidates = [path.join(dir, `${slug}.mdx`), path.join(dir, `${slug}.md`)]
  const file = candidates.find((p) => fs.existsSync(p))
  if (!file) return null

  const raw = fs.readFileSync(file, 'utf8')
  const { data, content } = matter(raw)

  const frontmatter: PostFrontmatter = {
    title: String(data.title ?? ''),
    description: String(data.description ?? ''),
    // Trust the filename for the slug so the URL and the file can never drift.
    slug: String(data.slug ?? slug),
    locale: (data.locale as Locale) ?? locale,
    publishedAt: String(data.publishedAt ?? ''),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    author: String(data.author ?? 'BoekBrug'),
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
    relatedTool: String(data.relatedTool ?? ''),
    relatedToolLabel: String(data.relatedToolLabel ?? ''),
    coverImage: data.coverImage ? String(data.coverImage) : undefined,
    alternateSlug: data.alternateSlug ? String(data.alternateSlug) : undefined,
    transKey: data.transKey ? String(data.transKey) : undefined,
    pillarSlug: data.pillarSlug ? String(data.pillarSlug) : undefined,
    pillarTitle: data.pillarTitle ? String(data.pillarTitle) : undefined,
    draft: data.draft === true,
  }

  return {
    frontmatter,
    content,
    readingMinutes: Math.max(1, Math.ceil(readingTime(content).minutes)),
  }
}

// Public loader for one article: returns null for missing OR draft posts so
// article pages 404 on drafts.
export function getPost(locale: Locale, slug: string): Post | null {
  const post = readPost(locale, slug)
  if (!post || post.frontmatter.draft) return null
  return post
}

// All published posts for a locale, newest first (by publishedAt desc).
export function getPublishedPosts(locale: Locale): Post[] {
  return rawSlugs(locale)
    .map((slug) => readPost(locale, slug))
    .filter((p): p is Post => p !== null && !p.frontmatter.draft)
    .sort((a, b) => b.frontmatter.publishedAt.localeCompare(a.frontmatter.publishedAt))
}

// Published slugs for a locale — feeds generateStaticParams so drafts are never
// built into public pages.
export function getPublishedSlugs(locale: Locale): string[] {
  return getPublishedPosts(locale).map((p) => p.frontmatter.slug)
}

// Other published articles in the same topic cluster (same locale, same
// pillarSlug), excluding the article itself. Powers the "more in this guide"
// block, which wires the pillar↔cluster mesh without per-file editing.
export function getClusterSiblings(post: Post, limit = 4): Post[] {
  const { pillarSlug, slug, locale } = post.frontmatter
  if (!pillarSlug) return []
  return getPublishedPosts(locale)
    .filter((p) => p.frontmatter.pillarSlug === pillarSlug && p.frontmatter.slug !== slug)
    .slice(0, limit)
}

export interface AlternateRef {
  locale: Locale
  slug: string
  path: string
}

// Canonical translation-group key: the value shared by every language version
// of one article. Prefers explicit transKey; otherwise the NL slug (NL uses its
// own slug; en/ar/tr use alternateSlug, which points at the NL slug).
function canonicalKey(fm: PostFrontmatter): string {
  if (fm.transKey) return fm.transKey
  return fm.locale === DEFAULT_LOCALE ? fm.slug : fm.alternateSlug ?? fm.slug
}

// Every OTHER-language published version of this article, across all locales.
// Powers hreflang (all languages) and the language switch.
export function getAlternates(post: Post): AlternateRef[] {
  const key = canonicalKey(post.frontmatter)
  const out: AlternateRef[] = []
  for (const loc of LOCALES) {
    if (loc === post.frontmatter.locale) continue
    const match = getPublishedPosts(loc).find((p) => canonicalKey(p.frontmatter) === key)
    if (match) out.push({ locale: loc, slug: match.frontmatter.slug, path: articlePath(loc, match.frontmatter.slug) })
  }
  return out
}

// Back-compat single-alternate helper (first other-language version, if any).
export function getAlternate(post: Post): AlternateRef | null {
  return getAlternates(post)[0] ?? null
}
