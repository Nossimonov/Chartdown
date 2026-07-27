# 0029 — A shipped dependency is ours to answer for

- **Status:** Accepted
- **Date:** 2026-07-27
- **Issue:** [#181](https://github.com/Nossimonov/Chartdown/issues/181)
- **Builds on:** [ADR 0007](0007-typescript-stack.md), [ADR 0011](0011-mcp-server-runtime-deps.md), [ADR 0028](0028-measurement-is-an-optional-package-in-typescript.md)

## Context

[ADR 0028](0028-measurement-is-an-optional-package-in-typescript.md) accepts a package that decodes images, which is the first time Chartdown parses **untrusted binary input**. That raises a question the project has been able to ignore: what happens when something we ship depends on something exploitable?

It is not hypothetical, and it was not theoretical when this was written. Auditing the published tree for the first time found **two moderate advisories already present** — a path traversal in `@hono/node-server`'s static handler, reached through `@modelcontextprotocol/sdk`, shipped in `@chartdown/mcp`. Nothing in the project would ever have mentioned it: there was a committed lockfile and no audit, no Dependabot, and no policy. The advisory had simply been sitting in a published package.

The exposure is also worse than average for the tool being added. **Image decoders are among the most CVE-prone libraries in any ecosystem**, because their job is to parse hostile binary from strangers, and the classic failures — heap overflows in libpng and libjpeg, the ImageMagick family — are memory-safety bugs in native code. A tool whose input is "a satellite image you downloaded" is squarely in that blast radius.

## Decision

**A runtime dependency in a published package is a promise the project makes to its users, and is treated as one.** Four rules, in the order they bite:

**1. Prefer a built-in, then vendored code, then a dependency.** A dependency is justified by capability we cannot reasonably write, not by convenience. Where the standard library already does the hard part, that is the answer.

Applied to ADR 0028's decoder, this changes the plan and removes the exposure entirely: **`@chartdown/measure` accepts PNG, decoded against `node:zlib`, and ships with no runtime dependencies at all.** PNG decoding is chunk parsing, one `inflate` — which Node has — and undoing five per-scanline filters. That is a few hundred lines of ordinary array work, with no native code and no third-party parser between a stranger's file and the user's machine. JPEG is rejected with a message naming the conversion, because a baseline JPEG decoder is a real piece of engineering and no format we can decline is worth the risk surface. Interlaced and exotic bit depths are likewise refused by name rather than half-supported.

ADR 0028 anticipated "one well-scoped library"; this supersedes that expectation with none. The rest of 0028 stands.

**2. Bound the input before trusting the header.** Dimensions, decoded byte count and inflated size are checked against limits *before* allocating. A decompression bomb is a denial of service in pure JavaScript as much as in C, and the header is written by whoever supplied the file.

**3. What is shipped is audited, and the audit gates CI.** `npm audit --omit=dev --audit-level=moderate` runs on every push and every pull request. The `--omit=dev` is deliberate: an advisory in a test runner is a chore, and one in a published package is a vulnerability with our name on it, and conflating them trains everyone to ignore both. Dev-dependency advisories are handled by Dependabot's routine updates instead.

**4. Updates are routine so that they are not events.** Dependabot runs weekly over npm and GitHub Actions, with development dependencies grouped into one pull request. The point is that a bump is unremarkable, so the project is never discovering a long-stale transitive dependency at the moment it turns into an advisory.

## Alternatives considered

**Vendor an image decoder from an existing library.** Fewer lines than writing one, and it inherits the upstream's bugs with none of the upstream's patches — the worst of both, since a vendored copy is invisible to every audit tool.

**Depend on a pure-JS decoder** (`pngjs`, `jpeg-js` and similar). Reasonable, and rule 1 says a dependency needs to buy capability rather than time. PNG-over-`node:zlib` is small enough that the trade is not worth a supply-chain edge, a transitive tree, and a package that can be taken over.

**Depend on a native decoder** (`sharp`, `libvips`). Fastest by a wide margin, and it reintroduces exactly the memory-safety class this decision exists to avoid, plus a native build in a repo whose install is currently portable. Rejected in ADR 0028 on portability; rejected again here on security.

**Fail CI on any advisory, including development.** Tempting and counterproductive: a moderate advisory in a bundler blocks unrelated work, and the pressure is then to disable the check rather than fix anything. Severity gating on *shipped* code keeps the signal worth reading.

**Do nothing beyond the lockfile.** The status quo, and it had already failed silently. A lockfile guarantees reproducibility, not safety — it will faithfully reinstall a vulnerable version forever.

## Consequences

The measurement package now has a stronger property than planned: **zero runtime dependencies, like `core` and the renderer**, so ADR 0007's rule bends only for `@chartdown/mcp`. The concern that prompted this ADR is not managed but largely absent, which is a better outcome than a policy for handling it.

The cost is a hand-written PNG decoder to maintain and test, and a real limitation for users: imagery must be converted to PNG first. That is one command in any tool, and it is a fair price for not putting a binary parser we do not control in front of a stranger's file.

CI gains a job that can fail for reasons no commit caused — an advisory published against a version already in the tree. That is the intended behaviour, and it is why the gate is on shipped code only, where such a failure is genuinely worth stopping for.

The rules bind future packages too. Anything published from this repo answers rules 1–4, so a later decision to take a dependency is a decision to be argued rather than a convenience to be reached for.
