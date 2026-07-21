# @chartdown/cli

Command-line renderer for [Chartdown](https://github.com/Nossimonov/Chartdown) — plain-text TTRPG maps.

```sh
npx @chartdown/cli render map.cd -o map.svg
npx @chartdown/cli render map.cd --mode gm -o map-gm.svg   # with GM secrets
npx @chartdown/cli check map.cd                             # fail-loud validation
```

Exit codes: 0 clean, 1 document errors (render still writes best-effort output), 2 bad usage. Try the [playground](https://nossimonov.github.io/Chartdown/) or see the [spec](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec).
