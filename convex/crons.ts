import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "expire abandoned rooms and prune old room details",
  { hourUTC: 8, minuteUTC: 20 },
  internal.rooms.runRoomLifecycle
);

export default crons;
