import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "expire abandoned rooms and prune old room details",
  "20 8 * * *",
  internal.rooms.runRoomLifecycle,
  {}
);

crons.cron("delete client errors unseen for 30 days", "40 8 * * *", internal.clientErrors.prune, {});

export default crons;
