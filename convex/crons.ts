import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "expire abandoned rooms and prune old room details",
  "20 8 * * *",
  internal.rooms.runRoomLifecycle,
  {}
);

export default crons;
