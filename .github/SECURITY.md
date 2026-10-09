# Security policy

## Reporting a vulnerability

Report it privately. Do not open a public issue or pull request for it.

Use **Security → Report a vulnerability** on this repository
(<https://github.com/arunpaul-H/coding-agent-harness/security/advisories/new>). That opens a private
advisory only the maintainers can see.

Include what you can of:

- the script or guard involved, and the commit you tested;
- the input that triggers it: a tool call, a config file, a command line;
- what happened and what should have happened;
- your OS and Node version.

This is maintained by one person, on a best-effort basis. You will get a reply on the advisory,
and a fix is published there with credit to you unless you ask otherwise.

## Supported versions

Only the tip of `main` is supported. There are no maintained release branches.

## What counts

- A guard that allows what its own `--self-test` says it denies.
- A way for a crafted repository, config file or doc to make a harness script run a command, or
  write outside the repo it was pointed at.
- A gate that reports green for a run it did not make.
- Anything in the CI workflow that would hand a pull request from a fork a token or a secret.

## What does not

The guards match patterns. A different spelling of the same action can get through, and the
README says so under "What it does not do". They stop accidents, not a determined agent or an
attacker, and a new spelling that gets past one is a bug report, not a vulnerability: open an
ordinary issue.
