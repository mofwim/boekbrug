// src/components/legal-article.tsx
// [LEGAL] Renders an embedded legal markdown string as a styled, readable
// document. Server component — react-markdown + remark-gfm (tables, etc).
// Shared by /privacy, /voorwaarden and /cookies so they look identical.

import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PublicFooter from '@/components/public-footer'

const text: React.CSSProperties = { color: '#3c3c43', fontSize: 15, lineHeight: 1.7 }

// react-markdown passes an internal `node` prop to every custom component;
// strip it (on a shallow copy) so it never leaks onto the DOM as
// node="[object Object]".
function omitNode<P extends { node?: unknown }>(props: P): Omit<P, 'node'> {
  const rest = { ...props }
  delete (rest as { node?: unknown }).node
  return rest
}

const components: Components = {
  h1: (p) => (
    <h1 style={{ fontSize: 30, fontWeight: 800, color: '#1c1c1e', letterSpacing: -0.5, margin: '0 0 16px' }} {...omitNode(p)} />
  ),
  h2: (p) => (
    <h2 style={{ fontSize: 21, fontWeight: 700, color: '#1c1c1e', margin: '32px 0 12px' }} {...omitNode(p)} />
  ),
  h3: (p) => (
    <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1c1c1e', margin: '22px 0 8px' }} {...omitNode(p)} />
  ),
  p: (p) => <p style={{ ...text, margin: '0 0 14px' }} {...omitNode(p)} />,
  ul: (p) => <ul style={{ ...text, margin: '0 0 14px', paddingLeft: 22 }} {...omitNode(p)} />,
  ol: (p) => <ol style={{ ...text, margin: '0 0 14px', paddingLeft: 22 }} {...omitNode(p)} />,
  li: (p) => <li style={{ margin: '4px 0' }} {...omitNode(p)} />,
  strong: (p) => <strong style={{ color: '#1c1c1e', fontWeight: 700 }} {...omitNode(p)} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #ececf1', margin: '28px 0' }} />,
  a: (p) => <a style={{ color: '#007aff', textDecoration: 'underline' }} {...omitNode(p)} />,
  code: (p) => (
    <code style={{ background: '#f2f2f7', borderRadius: 5, padding: '1px 6px', fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#1c1c1e' }} {...omitNode(p)} />
  ),
  table: (p) => (
    <div style={{ overflowX: 'auto', margin: '0 0 16px', border: '1px solid #ececf1', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }} {...omitNode(p)} />
    </div>
  ),
  th: (p) => (
    <th style={{ textAlign: 'left', padding: '9px 12px', background: '#f9f9fb', borderBottom: '1px solid #ececf1', fontWeight: 700, color: '#1c1c1e', whiteSpace: 'nowrap' }} {...omitNode(p)} />
  ),
  td: (p) => (
    <td style={{ padding: '9px 12px', borderBottom: '1px solid #f0f0f4', color: '#3c3c43', verticalAlign: 'top' }} {...omitNode(p)} />
  ),
  blockquote: (p) => (
    <blockquote style={{ borderLeft: '3px solid #d1d1d6', margin: '0 0 14px', padding: '4px 0 4px 16px', color: '#6b6b6e' }} {...omitNode(p)} />
  ),
}

export default function LegalArticle({ markdown }: { markdown: string }) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 72px' }}>
        <Link href="/" style={{ display: 'inline-block', fontSize: 14, color: '#007aff', textDecoration: 'none', marginBottom: 20 }}>
          ← Terug naar home
        </Link>
        <article style={{ background: '#fff', border: '1px solid #ececf1', borderRadius: 18, padding: '32px 28px', boxShadow: '0 2px 14px rgba(0,0,0,0.04)' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {markdown}
          </ReactMarkdown>
        </article>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 28 }}>
          BoekBrug — de brug tussen jou en je boekhouder.
        </p>
      </div>
      <PublicFooter />
    </div>
  )
}
