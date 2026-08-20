import "dotenv/config";
import cron from "node-cron";
import { main } from "./index.js";

console.log("Scheduler started — running daily at 9 AM Pacific.");

function run() {
  console.log(`[${new Date().toLocaleString()}] Running scheduled scan...`);
  main().catch((err) => console.error("Scheduled run failed:", err));
}

cron.schedule("0 9 * * *", run, { timezone: "America/Los_Angeles" });
