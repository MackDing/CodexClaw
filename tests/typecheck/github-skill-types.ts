import type { GitHubTestJob } from "../../src/orchestrator/skills/githubSkill.js";

const job: GitHubTestJob = {
  jobId: "job-123",
  status: "running",
  workdir: "/tmp/repo",
  command: "npm test",
  startedAt: "2026-03-14T00:00:00.000Z",
  finishedAt: "",
  exitCode: null,
  output: ""
};

void job;
