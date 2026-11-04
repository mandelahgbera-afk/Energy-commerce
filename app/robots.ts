import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

// Search engines see the public shop. Staff screens stay out (they need a login anyway).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: ['/', '/shop'], disallow: ['/counter', '/stock', '/owner', '/books', '/requests', '/import', '/settings', '/auth', '/login', '/kit', '/help'] },
    sitemap: `${site}/sitemap.xml`,
  };
}
