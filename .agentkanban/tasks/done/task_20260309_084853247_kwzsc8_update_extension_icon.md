---
title: Update extension icon
lane: done
created: 2026-03-09T08:48:53.247Z
updated: 2026-03-09T20:05:41.223Z
---

## Conversation

[user]

We need to update the extension icon svg so that it is 3 solid bars with spacing between them, rather than 3 outlines

[agent]

Updated `images/kanban-icon.svg`:

- Removed `fill="none"`, `stroke="currentColor"`, `stroke-width`, `stroke-linecap`, `stroke-linejoin` attributes
- Set `fill="currentColor"` on the root `<svg>` element so the 3 rectangles render as solid filled bars
- Adjusted x positions (1, 9, 17) to maintain even spacing between the bars
- Build verified clean

[user]