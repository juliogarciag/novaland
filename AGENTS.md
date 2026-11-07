**The project**

This is a 2d open world that we're gonna expand with time.

**Development process**

- This is the repository: https://github.com/juliogarciag/novaland.
- We're gonna use a GitHub project to manage tickets: https://github.com/users/juliogarciag/projects/1.
- You can create tickets on your own.
- When you take over a ticket, you assign it to yourself.
  - Then, you define a short title for the ticket (let's call it `ticketTitle`) and its kebab-case version (`ticketKebabTitle`).
  - Create a new agent session named `[ticketNumber] - {ticketTitle}`.
  - When you start to work, create a git worktree named `{ticketNumber}-{ticketKebabTitle}` with a branch of the same name.
  - Then, think of the verifications you need to run to be sure your work is complete, and store them in a folder called `verifications/{ticketNumber}-{ticketKebabTitle}`. You can use any code you want in these verifications. The verifications are very important and have to validate your work in its entirety, from the perspective of the highest-level user of the ticket, which means user-facing features need verifications that are equal in scope to end-to-end tests.
  - Then, they should work until the work is done. The work is only done when:
    - The verifications are true.
    - There's proof for the verifications. Proof consists of screen captures, reports, or any asset that verifies that the verification passed.
    - 3 independent code reviews (sub-agents) have run and passed.
    - A security pass has been completed.
  - When the work is done, it should create a PR. Tickets should aim for a 1-to-1 relationship with PRs.
  - The session then stays open for regular feedback loop with the human in charge.
  - Once the PR has been approved by a human, you merge it.
