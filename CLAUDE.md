# language rules
- I talk to you in English.
- You talk to me in Japanese.
- Write all the documents/messages/comments in English.

# git rules
- git add/commit/push only if I ask you to do so.
- don't git restore/checkout/revert/add -A.
- commit messages is in the following format:
```
[short description]
[empty line]
- [change item 1]
- [change item 2]
```
or
```
[short description]
```

- commit message rules:
  - the number of the change items should be MECE.
    - don't write the redundant change items.
    - Don't miss the necessary change items.
    - use git diff when you make a commit message suggestion.
  - commit message suggestion is written in commit-msg.txt.

# test and deployment rules
- don't run test and deployment by yourself.
- I run test and deployment by scripts in scripts/ directory.
- Ask me to run test and deployment when you finish the implementation.

# Project
- This is the project to make a modular-type timeline in nostr.

# Specifications
- see spec.md.
- edit spec.md when the implementation is changed.

# others 
- version APP_VERSION on src/App.tsx shall be updated in every deployment.

# References
- rete.js: https://rete.js.org/
  - github: https://github.com/retejs
- nostr
  - NIP-01: https://github.com/nostr-protocol/nips/blob/master/01.md
  - rx-nostr: https://github.com/penpenpng/rx-nostr
    - document https://penpenpng.github.io/rx-nostr/
- nostter: https://github.com/SnowCait/nostter
- rabbit: https://github.com/syusui-s/rabbit

