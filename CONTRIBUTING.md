# Contributing

Thanks for your interest in DUR.

## Before contributing
- Read the README and architecture and security documents.
- Check existing issues before starting substantial work.
- For large changes, open an issue first to discuss scope and design.
- Do not submit secrets, private keys, seed phrases, bot tokens or personal data.

## Development
Requirements: Node.js 20+ and npm.
~~~bash
npm install
npm run dev
npm run build
~~~

## Pull requests
A good pull request should solve one focused problem, explain motivation and design, include tests or a manual verification plan, update relevant documentation, and avoid claiming that planned functionality is already live.

## Code style
- TypeScript for application code.
- Prefer small, typed modules and explicit boundaries.
- Treat all client-provided data as untrusted.
- Keep secrets out of source code and commit history.
- Preserve the Testnet-first development policy.

Security-sensitive changes to authentication, wallet proof verification, reputation, attestations or escrow require a threat analysis in the pull request description.
