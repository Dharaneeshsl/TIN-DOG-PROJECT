# Browser verification — 2026-08-17

Local URL: http://127.0.0.1:3000/

Observed states:

1. Public React landing page rendered with local hero assets, navigation, pricing, stats strip, trust/features sections, and footer.
2. Signup modal opened from the real landing page. A disposable local account was created through the React form: Audit Owner / Audit Pup / audit-final-20260817@example.com.
3. Authenticated discovery rendered from the Express API with a real seeded test profile, compatibility score, filter controls, pass/super-like/like controls, and completeness prompt.
4. Profile screen rendered owner name, dog fields, health checkboxes, image upload affordance, interests, and save action.
5. Billing screen activated the free plan and displayed Current: Puppy plus a paid Puppy transaction in payment history.
6. Paid Adult Dog checkout without credentials displayed the actionable error `Stripe is not configured. Add STRIPE_SECRET_KEY.` and restored normal plan-button labels.

This file records observed UI behavior only; production seed data remains disabled by default and the account was created solely for local verification.
