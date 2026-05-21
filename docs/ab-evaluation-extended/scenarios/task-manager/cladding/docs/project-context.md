<!-- Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad refine -->

# task-manager — Project Context

## 1. Why does this project exist?

This is the **cladding** group of the large-scale A/B evaluation framework (F-0144b9). A 30-feature task-manager React app, fully scaffolded by cladding's SSoT governance. The sibling `vanilla/` directory ships the same React app without governance — comparing the two lets reviewers see exactly what cladding adds at scale.

## 2. What problem does it solve?

Demonstrates, at scale (30 features instead of the 1-feature M2 in the earlier F-4db939/F-ba2e05 A/B tests), that cladding's structural artifacts (spec shards, capabilities, architecture rules) compose into a queryable knowledge graph an AI agent can navigate. Vanilla provides no such surface; cladding's value is proportional to feature count.

## 3. What is its purpose?

To produce a **browseable, runnable** demonstration of cladding-at-scale that a user can `cd` into and explore. Each of the 30 features is implemented in shared React components but documented in its own `spec/features/<slug>-<hash>.yaml` shard with explicit ACs and module paths.
