import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "prune old AI logs",
  { hourUTC: 3, minuteUTC: 0 },
  internal.aiLogs.prune,
);

export default crons;
