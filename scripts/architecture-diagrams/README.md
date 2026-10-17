# Architecture diagrams

Generators for the two architecture SVGs in `docs/architecture/`. Both use the
Obsidian Frequency colour roles (`web/src/styles/tokens.css`), deepened for a
light canvas, and carry their own background so they read the same in GitHub's
light and dark themes.

| Script | Output |
| --- | --- |
| `application.py` | `docs/architecture/resonate-application-architecture.svg` |
| `deployment.py` | `docs/architecture/resonate-deployment-architecture.svg` |

Edit the script, not the SVG, then regenerate from the repository root:

```bash
python3 scripts/architecture-diagrams/application.py
python3 scripts/architecture-diagrams/deployment.py
```

Pass a path argument to write somewhere else, for example a scratch preview.
The scripts use only the Python standard library.

The deployment diagram is public. Show the mechanism (components, data paths,
release gates) and leave deployment facts in `resonate-iac`: project IDs, URLs,
hostnames, job names and schedules, and claims about what currently runs in an
environment.
