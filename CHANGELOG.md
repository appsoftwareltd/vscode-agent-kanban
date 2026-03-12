# Changelog

All notable changes to AS Notes will be documented here.

## [2.0.0] - 2026-03-12

- Major change to support Git worktree based workflows, leveraging VS Code support for Git worktrees
- `/plan`, `/todo`, `/implement` `@kanban` participant commands are gone in favour of `/refresh` for non worktree based workflow
- Automatic commit of tasks when creating Git worktrees (for availability in new worktree)
- Documentation updated

## [1.0.5] - 2026-03-11

- Bump esbuild version on dependabot alert

## [1.0.4] - 2026-03-11

- Fix side bar / board focus behaviour

## [1.0.3] - 2026-03-10

- Bugfix: Agent should not initialise workspace automatically - requires user action.

## [1.0.2] - 2026-03-10

- Bugfix: Fix task editor close on mouse event bug.

## [1.0.1] - 2026-03-10

- Chore: Bump releases.

## [1.0.0] - 2026-03-09

- Feature: Directory based task / lane synchronisation to prevent a large singe `tasks` directory
- Feature: Layered agent instruction approach

## [0.3.0] - 2026-03-09

- Feature: Major UI overhaul - board moved to editor tab from side bar

## [0.2.1] - 2026-03-07

### Added

- Chore: Name bump
- Feature: Release polish

## [0.1.2] - 2026-03-07

### Added

- Chore: Extension `.gitignore` under `.agentkanban`
- Feature: Re-ordering swimlanes with deletion rules

## [0.1.1] - 2026-03-07

### Added

- Feature: Initial release.
