# Stillmark Workbench Rules

## Scope

* This repository contains the Stillmark Workbench plugin for SiYuan Note.
* Keep tools independent and small; shared shell code belongs in `src/` and tool-specific logic should be split into focused modules as it grows.

## Workflow

* Do not use Superpowers skills, workflows, or document templates in this repository.
* Keep project plans and specifications in neutral project-owned paths such as `docs/plans/` and `docs/specs/` when they are needed.

## Git

* Do not modify `main` directly. Work on `feature/*` branches and merge through a pull request.
* Do not create worktrees.

## SiYuan data safety

* Use official plugin and kernel APIs before relying on internal DOM behavior.
* Do not directly read or write files under the SiYuan workspace `data` directory.
* Scope mutations to explicit user selections and report partial failures.

## Interface

* Reuse SiYuan variables and native component classes.
* Keep the interface quiet, compact, and free of decorative gradients or heavy shadows.
* Support light and dark modes without changing global appearance settings.

## Verification

* Run `pnpm check` and `git diff --check` before publishing changes.
* Verify data mutations against a disposable test block before a release.
