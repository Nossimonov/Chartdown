# The Undercellar

**Status: spec-aligned.**

A small cellar whose water is placed by **what it runs between**, not by the cells it happens to cross. Written from [#238](https://github.com/Nossimonov/Chartdown/issues/238), which asked for the form a battlemap author reaches for and gets silence from.

| | |
|---|---|
| `stream runnel "The Runnel" : from fountain to sinkhole` | a **course** between two anchors (spec 02 §7). Move either pond and the runnel follows — the `path` spelling would keep its old cells and say nothing, which is rule 4's live anchors honoured at tactical scale |
| `stream seep "The Seep" : from spring join runnel` | `join` meets the trunk **where the seep arrives**, at the nearest cell, rather than at its midpoint (spec 02 §7, [#94](https://github.com/Nossimonov/Chartdown/issues/94)) — and the trunk it joins is itself a resolved course |
| `door : F7.w` / `door : N7.e` | the cellar opens both ways onto the floor the party crosses to reach it |

The seep is the interesting line twice over. It runs **east to west**, which is the direction that reads backwards if a renderer lets a name ride its course the way the course was declared — the author writes the spring first because that is where the water starts, not because the label should be mirrored. And it anchors on a course that is itself resolved, which is the ordering a naive implementation gets wrong: writing this example is what found both.
