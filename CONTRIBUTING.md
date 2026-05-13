# Contributing to MindeesAI

> First-time contributors very welcome — there is a [`good first issue`](https://github.com/aashir-athar/mindeesai/labels/good%20first%20issue) label specifically for you.

We are building a self-improving open-source AI in public. Every contribution — a typo fix, a new connector, a reflection-prompt tweak — directly makes the system smarter.

---

## Ways to contribute

| Contribution | Difficulty | Where to start |
|---|---|---|
| Fix a typo or doc issue | trivial | open a PR directly |
| Add a new **connector** | easy–medium | see [docs/CONNECTORS.md](docs/CONNECTORS.md) |
| Improve a **reflection prompt** | medium | `lib/prompts/reflection/*.ts` |
| Add a **provider** to the LLM router | medium | `lib/llm/providers/` |
| Architectural changes | hard | open an issue first |

---

## Local development

```bash
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai
pnpm install
cp .env.example .env.local
pnpm dev
```

See [docs/SETUP.md](docs/SETUP.md) for the full version (Ollama setup, model downloads, etc.).

---

## Commit conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(connector): add wolfram-alpha calculator connector
fix(memory): handle empty LanceDB tables on first boot
docs(readme): improve "Why MindeesAI" section
refactor(orchestrator): extract tool-call loop into its own module
test(reflector): add fixtures for low-confidence insights
```

Type vocabulary: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`.

---

## Branch naming

```
<type>/<short-kebab-summary>

feat/wolfram-connector
fix/empty-lancedb-boot
docs/connector-permissions
```

---

## Pull-request checklist

- [ ] Conventional Commits in title
- [ ] One logical change per PR (split if necessary)
- [ ] Tests for new code (`pnpm vitest run`)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Updated relevant docs under `docs/`
- [ ] If you added a connector, added a row to the README's Connectors table

---

## Code style

- TypeScript strict mode — no `any` without a `// reason: ...` comment.
- Prefer pure functions; isolate side-effects in the `lib/*` modules they belong to.
- Comments explain **why**, never **what** — see [CLAUDE.md](#) for the project comment philosophy.
- Imports use the `@/*` alias.

---

## Code of conduct

Be kind. Assume positive intent. Disagreement is welcome; rudeness is not. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## Maintainer

- [@aashir-athar](https://github.com/aashir-athar)

Questions? Open a [Discussion](https://github.com/aashir-athar/mindeesai/discussions) or DM on X.
