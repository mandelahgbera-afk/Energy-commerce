# Login emails

Five emails Supabase sends for staff logins, in the shop's own look. Every button opens
`/auth/confirm` on the shop's site. That page checks the link, then asks for a password (for an
invite or a reset) or signs the person in.

## For each shop
1. Open `build.mjs`, set `SHOP` to the shop's name, then run:
   `node supabase/templates/build.mjs`
2. In Supabase, go to **Authentication → Emails → Templates**. For each type, paste the subject
   from `subjects.txt` and the whole HTML file:

   | Supabase template | File |
   |---|---|
   | Invite user | `invite.html` |
   | Reset password | `reset-password.html` |
   | Magic link | `magic-link.html` |
   | Change email address | `change-email.html` |
   | Confirm signup | `confirm-signup.html` |

3. Check that **Authentication → URL Configuration → Site URL** is the shop's address, such as
   `https://yourshop.ng`. The buttons are built from it.
4. Test it: in **Authentication → Users**, choose your own user and send a password recovery.
   The email should arrive from your Resend address, and its button should open your site.

Without custom email settings (SMTP) on, Supabase's built-in sender sends only a few emails an
hour, so set up Resend first (see `docs/go-live-setup.md`).
