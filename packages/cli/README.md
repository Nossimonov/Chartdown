# @chartdown/cli

Command-line renderer for [Chartdown](https://github.com/Nossimonov/Chartdown) — plain-text TTRPG maps.

```sh
npx @chartdown/cli render map.cd -o map.svg
npx @chartdown/cli render map.cd --mode gm -o map-gm.svg   # with GM secrets
npx @chartdown/cli check map.cd                             # fail-loud validation
npx @chartdown/cli frame "(38,60) (43,70) (41,80)"          # trace -> anchored outline
```

`frame` converts an **absolute** trace into the anchored form a detached feature's outline needs (spec 05 §4): an anchor plus offsets from it, so moving the feature is one coordinate rather than a transform of every vertex. It prints the clause on stdout and a summary on stderr, so `chartdown frame … > clause.txt` gives just the clause. Pass `--at x,y` to keep an anchor a feature already has; omitted, one is derived from the shape's centre.

Exit codes: 0 clean, 1 document errors (render still writes best-effort output), 2 bad usage. Try the [playground](https://nossimonov.github.io/Chartdown/) or see the [spec](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec).
