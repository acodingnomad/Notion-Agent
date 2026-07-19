import "dotenv/config";
import cron from "node-cron";
import { main } from "./index.js";

console.log("Scheduler started — running 2x/day at 9 AM and 5 PM Pacific.");

function run() {
  console.log(`[${new Date().toLocaleString()}] Running scheduled scan...`);
  main().catch((err) => console.error("Scheduled run failed:", err));
}

cron.schedule("0 9,17 * * *", run, { timezone: "America/Los_Angeles" });
