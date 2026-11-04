import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${site}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${site}/shop`, changeFrequency: 'daily', priority: 0.9 },
  ];
}
