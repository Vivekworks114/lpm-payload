import type { CollectionConfig } from 'payload'
import { sanitizeBlogSlug } from '@astropayload/payload-sdk/formatters'

import { authenticatedRead, cmsApiRead } from '../access/tenantAccess'
import { totpPublicReadCustom } from '../access/totpPublicRead'
import {
  contentPublishComponents,
  publishContentBarField,
  seoFields,
  slugField,
} from './_shared'

/**
 * Blog posts synced to Astro markdown frontmatter (title, description, dates,
 * images, excerpt, metaTitle, metaDescription, plus optional `extra` keys).
 */
export const BlogPosts: CollectionConfig = {
  slug: 'blog-posts',
  custom: totpPublicReadCustom,
  labels: { singular: 'Blog Post', plural: 'Blog Posts' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'publishStatus', 'pubDate', 'updatedAt'],
    group: 'Content',
    components: contentPublishComponents,
  },
  access: {
    read: cmsApiRead,
    create: authenticatedRead,
    update: authenticatedRead,
    delete: authenticatedRead,
  },
  hooks: {
    beforeValidate: [
      ({ data, operation }) => {
        if (!data) return

        if (operation === 'create') {
          const title = typeof data.title === 'string' ? data.title.trim() : ''
          const slugRaw =
            typeof data.slug === 'string' && data.slug.trim() ? data.slug : title
          if (slugRaw) data.slug = sanitizeBlogSlug(slugRaw)
          return
        }

        // Update: only normalize slug when the editor changed it — content-only saves
        // keep the existing URL stable.
        if (typeof data.slug === 'string' && data.slug.trim()) {
          data.slug = sanitizeBlogSlug(data.slug)
        }
      },
    ],
  },
  fields: [
    publishContentBarField(),
    { name: 'title', type: 'text', required: true },
    slugField(),
    { name: 'description', type: 'textarea', required: true },
    {
      name: 'publishStatus',
      type: 'select',
      defaultValue: 'published',
      required: true,
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Scheduled', value: 'scheduled' },
        { label: 'Published', value: 'published' },
      ],
      admin: {
        description:
          'Draft = CMS only. Scheduled = CMS only until pub date (hourly cron promotes to Published and deploys). Published = included on live site when Pub date is today or earlier.',
        position: 'sidebar',
      },
    },
    {
      name: 'pubDate',
      type: 'date',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Display date on the site. Also used as the go-live time for scheduled posts.',
      },
    },
    { name: 'updatedDate', type: 'date' },
    {
      name: 'heroImage',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          'Main post image. Synced as heroImage (and featuredImage when empty) in markdown — R2 CDN URL or local path.',
      },
    },
    {
      name: 'featuredImage',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          'Optional card/listing image. Synced as featuredImage in markdown. Falls back to Hero image when empty.',
      },
    },
    { name: 'author', type: 'text' },
    {
      name: 'categories',
      type: 'array',
      fields: [{ name: 'value', type: 'text', required: true }],
    },
    {
      name: 'tags',
      type: 'array',
      fields: [{ name: 'value', type: 'text', required: true }],
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
    },
    {
      name: 'extra',
      type: 'json',
      admin: {
        description:
          'Optional custom frontmatter fields for this site (merged into markdown on publish). Use when the connected repo expects extra keys.',
      },
    },
    seoFields(),
  ],
}
