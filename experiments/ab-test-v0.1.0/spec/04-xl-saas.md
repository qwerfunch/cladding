# Sample 04 — Enterprise SaaS backend (XL)

100 features across 10 domains. Total ACs: 199.

Status distribution: 70 done · 20 in_progress · 10 planned.

## Domains

### auth
- auth/register
- auth/login
- auth/logout
- auth/refresh-token
- auth/reset-password
- auth/verify-email
- auth/enable-2fa
- auth/disable-2fa
- auth/list-sessions
- auth/revoke-session

### users
- users/create
- users/read
- users/update
- users/delete
- users/invite
- users/list
- users/search
- users/export-pii
- users/merge
- users/soft-delete

### orgs
- orgs/create
- orgs/rename
- orgs/transfer-owner
- orgs/add-member
- orgs/remove-member
- orgs/list-members
- orgs/list-roles
- orgs/set-role
- orgs/delete
- orgs/export-data

### billing
- billing/attach-card
- billing/detach-card
- billing/list-cards
- billing/set-default-card
- billing/create-customer
- billing/tax-id
- billing/address
- billing/currency
- billing/preview-charge
- billing/reconcile

### invoicing
- invoicing/create
- invoicing/finalize
- invoicing/send
- invoicing/void
- invoicing/pay
- invoicing/refund
- invoicing/list
- invoicing/detail
- invoicing/download-pdf
- invoicing/apply-credit

### subscriptions
- subscriptions/create
- subscriptions/cancel
- subscriptions/reactivate
- subscriptions/upgrade
- subscriptions/downgrade
- subscriptions/pause
- subscriptions/resume
- subscriptions/list-items
- subscriptions/usage-record
- subscriptions/preview-proration

### webhooks
- webhooks/create-endpoint
- webhooks/list-endpoints
- webhooks/delete-endpoint
- webhooks/rotate-secret
- webhooks/replay-event
- webhooks/list-deliveries
- webhooks/retry-policy
- webhooks/pause-endpoint
- webhooks/verify-signature
- webhooks/introspect

### audit
- audit/record-event
- audit/list-events
- audit/filter-by-actor
- audit/filter-by-resource
- audit/retention-policy
- audit/export
- audit/redact
- audit/tamper-seal
- audit/replay-window
- audit/search

### admin
- admin/impersonate
- admin/feature-flag
- admin/maintenance-mode
- admin/reindex-search
- admin/flush-cache
- admin/list-incidents
- admin/declare-incident
- admin/resolve-incident
- admin/rotate-key
- admin/audit-trail

### search
- search/index-document
- search/query
- search/autocomplete
- search/facet
- search/reindex
- search/list-indices
- search/delete-index
- search/sync-status
- search/analyzer-config
- search/highlight
