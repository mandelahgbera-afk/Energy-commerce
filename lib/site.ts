// The site's own address, for the share image and links. Set NEXT_PUBLIC_SITE_URL in Vercel to
// the live domain (a trailing slash is fine); until then Vercel's production address is used.
export const site = (process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/+$/, '');
