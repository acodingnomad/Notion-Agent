import "dotenv/config";
import cron from "node-cron";
import { main } from "./index.js";

console.log("Scheduler started — running 8x/day, every 90 min from 9 AM to 7 PM Pacific.");

function run() {
  console.log(`[${new Date().toLocaleString()}] Running scheduled scan...`);
  main().catch((err) => console.error("Scheduled run failed:", err));
}

const tz = { timezone: "America/Los_Angeles" };
// 9:00, 12:00, 3:00, 6:00, 7:00 PM
cron.schedule("0 9,12,15,18,19 * * *", run, tz);
// 10:30, 1:30, 4:30 PM
cron.schedule("30 10,13,16 * * *", run, tz);
