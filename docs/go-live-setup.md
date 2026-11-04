# Go-live setup: Supabase, Resend, the domain and Vercel

Written 3 Nov 2026. The app reads only two settings today: `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. It sends no email of its own yet, so Resend is used for one thing
for now: Supabase's sign-in and password emails. Never paste a key or password into a chat.

## 1. Resend (do this first: the DNS takes a while)
1. Resend → Domains → Add domain. Use a subdomain, such as `mail.yourdomain.com`, so the shop's
   main email is never affected.
2. Add every DNS record Resend shows (SPF and DKIM, plus the MX for bounces) at whoever runs your
   domain's DNS. Wait until Resend shows **Verified**.
3. Also add a DMARC record to start gently: name `_dmarc`, type TXT, value
   `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`.
4. Resend → API Keys → create a key with **Sending access only**, limited to that domain. Copy it
   once. It goes into Supabase in step 2.4, and nowhere else.

## 2. Supabase (the production project, in the shop's name)
Staging stays as it is, for testing. Production should be its own project: ask me before creating
it, so its migrations go in with `npm run db:apply` and get checked.
1. **Authentication → URL Configuration.** Site URL: `https://yourdomain.com`. Redirect URLs:
   `https://yourdomain.com/**`.
2. **Authentication → Sign In / Providers → Email.** Turn **off** "Allow new users to sign up".
   Only staff log in, and the owner gives each one a role. Anyone could otherwise make a login,
   even though it would open nothing.
3. Leave phone and social logins off.
4. **Authentication → Emails → SMTP Settings.** Turn on custom SMTP:
   host `smtp.resend.com`, port `465`, username `resend`, password = the Resend key from step 1.4,
   sender `no-reply@mail.yourdomain.com`, sender name: the shop's name.
5. **Authentication → Rate Limits.** Once SMTP is on, raise "emails per hour" from the built-in
   test limit to about 30.
6. **Authentication → Emails → Templates.** Paste the five branded login emails from `supabase/templates/`. Its README lists which file goes where.
7. **Project Settings → API.** Copy the Project URL and the anon (or "publishable") key for
   Vercel. Never copy the service_role (secret) key into Vercel: this app does not use it.
8. Supabase Free has no daily backups. Before real money goes in, the backup job from plan step
   1.1 has to be running. Ask me to build it when production exists.

## 3. Vercel
1. Push this repo to GitHub (I never push; you do, or tell me to). Then Vercel → Add New →
   Project → import `Energy-commerce`. Framework: Next.js. Leave the defaults alone.
2. Production branch: `main`.
3. **Settings → Environment Variables.** Two values, each set twice:
   | Name | Production | Preview |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | production project URL | staging project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production anon key | staging anon key |
   Previews then never touch real money.
4. **Settings → Domains.** Add `yourdomain.com` and `www.yourdomain.com`, then copy the exact DNS
   records Vercel shows into your DNS. Use Vercel's values, not ones from memory.
5. Vercel Pro is needed for a business ($20 a month), as already decided.

## 4. Not yet, but before the public shop is shared
- **Bot protection** on the quote form: Cloudflare Turnstile is free, but needs a Cloudflare
  account. Say yes and I'll wire it in. The form already allows only 5 requests per phone a day
  and 200 an hour for the whole shop.
- **The shop's real details:** set them in `/settings` (name, phone, address, hours). They then
  show on the public shop.
- A Resend key in Vercel will only be needed once the app sends its own emails (reminders).
  Not now.
