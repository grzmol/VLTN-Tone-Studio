## What changed

<!-- One subject per pull request. Say what changed and why. Link the issue if there is one. -->

## How it was checked

- [ ] `cd app && npm run typecheck && npm test && npm run test:toolkit`
- [ ] A screen change was opened in the browser on the mocks that matter (`?mock=gp5`, `gp50`, `gp200`, `gp200lt`, `gp200jr`, `gp150`, `gp180`), with a clean console
- [ ] Anything that writes to a pedal was tried on a real unit (model and firmware: ) or stays experimental

## Documentation

- [ ] A user-visible change has a line under `## [Unreleased]` in the changelog
- [ ] The guide in `docs/` that describes it is updated
- [ ] The commit subjects follow `type(scope): subject` and name what changed
