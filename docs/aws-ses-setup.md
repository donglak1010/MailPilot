# Amazon SES setup (Phase 3)

Region: **ap-northeast-1 (Tokyo)**. Keep every SES resource (identities, configuration set) in this one region.
The app never sees AWS keys in the browser — they live only in Supabase Edge Function secrets.

## 1. Account

1. Finish AWS sign-up (phone verification, payment method). Sign in to the console as root only for this setup.
2. Turn on MFA for the root user.

## 2. IAM user for MailPilot (SES only)

IAM → Users → Create user `mailpilot-ses` (no console access) → Attach policy directly → Create policy (JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MailPilotSes",
      "Effect": "Allow",
      "Action": [
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:DeleteEmailIdentity",
        "ses:PutEmailIdentityMailFromAttributes",
        "ses:GetAccount",
        "ses:SendEmail"
      ],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "ap-northeast-1" } }
    }
  ]
}
```

Then Security credentials → Create access key → "Application running outside AWS". Copy the key pair once;
do not paste it in chat, commits or the frontend `.env`.

## 3. Configuration set (events — used from Phase 4)

SES → Configuration sets → Create `mailpilot-default`. Event destinations are added in Phase 4 (SNS → webhook).
Set its name as `SES_CONFIGURATION_SET`; new identities are created with it as their default configuration set.

## 4. Edge Function secrets

Hosted project (run from the repo root, values typed by you):

```bash
supabase secrets set AWS_REGION=ap-northeast-1 SES_CONFIGURATION_SET=mailpilot-default
supabase secrets set AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
supabase secrets set APP_BASE_URL=https://<your-site> ALLOWED_ORIGINS=https://<your-site>,http://localhost:5173
supabase functions deploy sender-domains
```

Local development uses `supabase/functions/.env` (git-ignored). With `SES_MOCK=true` no AWS call is made;
to test against real SES locally, remove `SES_MOCK` and add the AWS variables, then restart
`supabase functions serve --env-file supabase/functions/.env`.

## 5. Sending domain (test: `mail.aithubs.com`)

1. In MailPilot → Sender Domains → Add domain → `mail.aithubs.com`.
2. Add the 6 records shown to the DNS zone of `aithubs.com` (Netlify → Domains → aithubs.com → DNS settings):
   - 3 × CNAME `<token>._domainkey.mail` → `<token>.dkim.amazonses.com`
   - MX `bounce.mail` → `feedback-smtp.ap-northeast-1.amazonses.com`, priority 10
   - TXT `bounce.mail` → `v=spf1 include:amazonses.com ~all`
   - TXT `_dmarc.mail` → `v=DMARC1; p=none;` (optional; the root DMARC already applies)

   Netlify appends `.aithubs.com` to names automatically. **Do not** edit the root SPF/MX records
   (they belong to ImprovMX forwarding).
3. Press **Check status** until Domain verification, DKIM and MAIL FROM are verified.

## 6. Sandbox and production access

New accounts are in the SES sandbox: only verified recipients, 200 emails / 24 h, 1 email/s.
- To test while in sandbox, verify your own inbox: SES → Identities → Create identity → Email address.
- Request production access (SES → Account dashboard → Request production access) once the app has
  unsubscribe handling (Phase 4). Describe: consent-based lists only, double-checked suppression,
  bounce/complaint handling via SNS, expected volume.

## 7. Monitoring

CloudWatch alarms on `Reputation.BounceRate` (> 4%) and `Reputation.ComplaintRate` (> 0.08%).
