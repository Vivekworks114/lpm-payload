import { lexicalToMarkdown } from '../lexical'

import { normalizeFrontmatterArrayFields } from './frontmatterArrays'
import { resolveBlogSlug, sanitizeBlogSlug } from './sanitizeBlogSlug'
import { sanitizeMarkdownForAstro } from './sanitizeMarkdownForAstro'
import { sanitizeMarkdownForMdx } from './sanitizeMarkdownForMdx'
import { quoteYamlScalar } from './yamlQuote'

export { quoteYamlScalar } from './yamlQuote'

/**
 * Frontmatter for Astro blog collections. Supports:
 *   - keukenfaqs-style: pubDate, title, description
 *   - WP / external repos: slug, date (required on some sites)
 */

interface BlogDoc {
  id: string
  title: string
  slug: string
  description: string
  pubDate: string
  updatedDate?: string | null
  author?: string | null
  heroImage?: { url?: string; alt?: string; filename?: string } | string | null
  featuredImage?: { url?: string; alt?: string; filename?: string } | string | null
  categories?: Array<{ value: string }> | null
  tags?: Array<{ value: string }> | null
  content: unknown
  extra?: Record<string, unknown> | null
  /** Payload SEO group — mapped to metaTitle / metaDescription in frontmatter. */
  seo?: {
    title?: string | null
    description?: string | null
  } | null
}

export interface FormattedFile {
  filename: string
  body: string
}

export type BlogFileExtension = 'md' | 'mdx'

export interface FormatBlogMarkdownOpts {
  /** Tenant ogImage/logo — used when a post has no featured image (WP-style required schemas). */
  fallbackFeaturedImage?: string | null
  /** Frontmatter from the site's git markdown (used when Payload has not stored WP paths yet). */
  repoFrontmatter?: Record<string, unknown> | null
}

/** Frontmatter keys owned by Payload — never overridden by `extra` on export. */
const RESERVED_FRONTMATTER_KEYS = new Set([
  'title',
  'description',
  'pubDate',
  'updatedDate',
  'author',
  'heroImage',
  'featuredImage',
  'excerpt',
  'metaTitle',
  'metaDescription',
  'meta_title',
  'meta_description',
  'categories',
  'tags',
  'slug',
  'date',
  // WP / CMS numeric ids break Astro content-layer (`id.endsWith is not a function`).
  'id',
])

export function formatBlogMarkdown(
  doc: BlogDoc,
  extension: BlogFileExtension = 'md',
  opts?: FormatBlogMarkdownOpts,
): FormattedFile {
  const extra = normalizeExtraRecord(doc.extra)
  const repo = opts?.repoFrontmatter ?? null
  const pubDate = normalizeFrontmatterDate(doc.pubDate)
  const frontmatter: Record<string, unknown> = {
    title: doc.title,
    description: doc.description,
    pubDate,
  }
  if (doc.updatedDate) frontmatter.updatedDate = normalizeFrontmatterDate(doc.updatedDate)
  if (doc.author) frontmatter.author = doc.author
  const hero =
    imageFrontmatterFromMedia(doc.heroImage) ??
    extraStringField(extra, 'heroImage') ??
    extraStringField(repo, 'heroImage')
  const featuredFromExtra = firstImageFromExtra(extra) ?? firstImageFromExtra(repo)
  const featured =
    imageFrontmatterFromMedia(doc.featuredImage) ??
    extraStringField(extra, 'featuredImage') ??
    extraStringField(repo, 'featuredImage') ??
    extraStringField(repo, 'featured_image') ??
    extraStringField(repo, 'image') ??
    featuredFromExtra ??
    hero
  if (hero) frontmatter.heroImage = hero
  if (featured) frontmatter.featuredImage = featured
  // WP / external Astro schemas often require excerpt (not just description).
  const excerpt =
    extraStringField(extra, 'excerpt') ??
    extraStringField(repo, 'excerpt') ??
    doc.description
  if (excerpt) frontmatter.excerpt = excerpt
  // Many Astro blog schemas require metaTitle / metaDescription (not optional SEO).
  const metaTitle =
    extraStringField(extra, 'metaTitle') ??
    extraStringField(extra, 'meta_title') ??
    extraStringField(repo, 'metaTitle') ??
    extraStringField(repo, 'meta_title') ??
    (typeof doc.seo?.title === 'string' && doc.seo.title.trim() ? doc.seo.title.trim() : undefined) ??
    doc.title
  const metaDescription =
    extraStringField(extra, 'metaDescription') ??
    extraStringField(extra, 'meta_description') ??
    extraStringField(repo, 'metaDescription') ??
    extraStringField(repo, 'meta_description') ??
    (typeof doc.seo?.description === 'string' && doc.seo.description.trim()
      ? doc.seo.description.trim()
      : undefined) ??
    doc.description
  if (metaTitle) frontmatter.metaTitle = metaTitle
  if (metaDescription) frontmatter.metaDescription = metaDescription
  if (doc.categories?.length) {
    frontmatter.categories = doc.categories.map((c) => c.value).filter(Boolean)
  }
  if (doc.tags?.length) {
    frontmatter.tags = doc.tags.map((t) => t.value).filter(Boolean)
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null || RESERVED_FRONTMATTER_KEYS.has(k)) continue
      frontmatter[k] = v
    }
  }
  if (repo) {
    for (const [k, v] of Object.entries(repo)) {
      if (v === undefined || v === null || RESERVED_FRONTMATTER_KEYS.has(k)) continue
      if (frontmatter[k] !== undefined && frontmatter[k] !== null && frontmatter[k] !== '') continue
      frontmatter[k] = v
    }
  }

  const slug = resolveBlogSlug(doc.slug, doc.title, doc.id)
  frontmatter.slug = slug
  if (frontmatter.date == null || frontmatter.date === '') {
    frontmatter.date = pubDate ?? normalizeFrontmatterDate(doc.pubDate)
  }

  const rawMd = lexicalToMarkdown(doc.content)
  const md =
    extension === 'mdx'
      ? sanitizeMarkdownForMdx(rawMd, { title: doc.title })
      : sanitizeMarkdownForAstro(rawMd, { title: doc.title })
  if (!frontmatter.featuredImage) {
    const fromContent = firstImageFromLexical(doc.content) ?? firstImageFromMarkdown(md)
    if (fromContent) frontmatter.featuredImage = fromContent
  }
  if (!frontmatter.featuredImage && opts?.fallbackFeaturedImage) {
    frontmatter.featuredImage = opts.fallbackFeaturedImage
  }

  normalizeFrontmatterArrayFields(frontmatter)
  coerceFrontmatterBooleans(frontmatter)

  // Never emit `id` into markdown — Astro glob() uses `data.slug` as the entry id, and a
  // numeric WP `id` (or numeric-looking unquoted `slug`) makes `id.endsWith()` throw.
  delete frontmatter.id

  const yaml = toYaml(frontmatter)
  return {
    filename: `${slug}.${extension}`,
    body: `---\n${yaml}---\n\n${md}`,
  }
}

/**
 * Image path or URL for markdown frontmatter from Payload media or extra JSON.
 * R2/CDN URLs (https://…) are included — most Astro themes use string frontmatter.
 */
function imageFrontmatterFromMedia(
  image?: { url?: string } | string | null,
): string | undefined {
  if (image == null) return undefined
  if (typeof image === 'string') {
    const trimmed = image.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof image === 'object' && image.url) {
    const url = image.url.trim()
    return url.length > 0 ? url : undefined
  }
  return undefined
}

/** Return a non-empty string value from doc.extra[key], or undefined. */
function extraStringField(
  extra: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!extra) return undefined
  const v = extra[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function normalizeExtraRecord(
  extra: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> | null {
  if (extra == null) return null
  if (typeof extra === 'string') {
    try {
      const parsed = JSON.parse(extra) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
    return null
  }
  if (typeof extra === 'object' && !Array.isArray(extra)) return extra
  return null
}

/** First markdown/HTML image src in post body (WP imports often embed images only in content). */
function firstImageFromMarkdown(md: string): string | undefined {
  const markdown = md.match(/!\[[^\]]*]\(([^)]+)\)/)
  if (markdown?.[1]) {
    const src = markdown[1].trim()
    if (src && looksLikeImagePath(src)) return src
  }
  const html = md.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (html?.[1]) {
    const src = html[1].trim()
    if (src && looksLikeImagePath(src)) return src
  }
  return undefined
}

/** Walk Lexical JSON for HTML `<img>` or image URLs in text nodes (common after WP import). */
function firstImageFromLexical(content: unknown): string | undefined {
  if (content == null) return undefined
  const stack: unknown[] = [content]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    const obj = node as Record<string, unknown>
    if (typeof obj.text === 'string') {
      const fromText = firstImageFromMarkdown(obj.text)
      if (fromText) return fromText
      const bare = obj.text.match(/(\/wp-content\/uploads\/[^\s"'<>]+)/i)
      if (bare?.[1] && looksLikeImagePath(bare[1])) return bare[1]
    }
    if (typeof obj.url === 'string' && looksLikeImagePath(obj.url)) return obj.url
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) stack.push(...v)
      else if (v && typeof v === 'object') stack.push(v)
    }
  }
  return undefined
}

/** Scan extra JSON for WP-style image path fields. */
function firstImageFromExtra(extra: Record<string, unknown> | null | undefined): string | undefined {
  if (!extra) return undefined
  const preferred = [
    'featuredImage',
    'heroImage',
    'image',
    'thumbnail',
    'coverImage',
    'featured_image',
    'featuredMedia',
  ]
  for (const key of preferred) {
    const v = extraStringField(extra, key)
    if (v && looksLikeImagePath(v)) return v
  }
  for (const [key, v] of Object.entries(extra)) {
    if (typeof v !== 'string' || !v) continue
    if (/image|photo|thumbnail|cover|featured|hero|media/i.test(key) && looksLikeImagePath(v)) {
      return v
    }
  }
  for (const v of Object.values(extra)) {
    if (typeof v === 'string' && looksLikeImagePath(v)) return v
  }
  return undefined
}

function looksLikeImagePath(value: string): boolean {
  const s = value.trim()
  if (!s) return false
  if (/^https?:\/\//i.test(s)) return true
  if (s.startsWith('/')) return true
  return /\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(s)
}

function normalizeFrontmatterDate(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

/** Keys Astro / WP themes commonly type as boolean in content schemas. */
const BOOLEAN_FRONTMATTER_KEYS = new Set(['draft', 'featured', 'published'])

function coerceFrontmatterBooleans(fm: Record<string, unknown>): void {
  for (const key of BOOLEAN_FRONTMATTER_KEYS) {
    if (!(key in fm)) continue
    const v = fm[key]
    if (typeof v === 'boolean') continue
    if (typeof v === 'string') {
      const lower = v.trim().toLowerCase()
      if (lower === 'true' || lower === 'yes' || lower === '1') fm[key] = true
      else if (lower === 'false' || lower === 'no' || lower === '0') fm[key] = false
    } else if (typeof v === 'number') {
      if (v === 1) fm[key] = true
      else if (v === 0) fm[key] = false
    }
  }
}

function toYaml(obj: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const v of value) lines.push(`  - ${quoteYamlScalar(String(v))}`)
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value ? 'true' : 'false'}`)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      lines.push(`${key}: ${value}`)
    } else if (value instanceof Date) {
      lines.push(`${key}: ${value.toISOString()}`)
    } else {
      lines.push(`${key}: ${quoteYamlScalar(String(value))}`)
    }
  }
  return lines.join('\n') + '\n'
}
