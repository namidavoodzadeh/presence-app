# Packages

One folder per frozen package: `packages/01/`, `packages/02/`, ...
A package is complete when it has all of these, and `FROZEN.md` records the owner's yes:

1. `screens.md`: the screen list
2. `flows/`: one state table per flow (state, event, next state)
3. `states.md`: loading, empty, failed and loaded for every screen that shows server data
4. `behaviour.md`: what each control does in each state, per screen
5. `copy.md`: every string
6. `routes.md`: the server routes the package needs
7. Tokens: any addition to DesignKit the package needs

Nothing in a frozen package changes during a cycle. New ideas go to the next package.
