# AI skills and project workflows

Project instructions live in [AGENTS.md](../AGENTS.md). See the
[agent configuration guide](../.agents/README.md) for the current workflow list,
rule ownership, and maintenance guidance.

The repository uses portable Markdown workflows under `.agents/workflows/`;
it does not vendor skill packages. Follow the corresponding file when a client
does not support slash-command discovery. Installed skills are supplied by the
active client and may differ between machines.

## External skills

Install or update external plugins through your client's supported mechanism.
Inspect the package source, permissions, scripts, and hooks before enabling it.
A marketplace listing does not guarantee safety or compatibility. Keep local
installation paths and machine-specific settings out of project instructions.

The security workflow files retain their original adaptation attribution.
Historical marketplace integration work is tracked in
[issue #353](https://github.com/akoita/resonate/issues/353).
